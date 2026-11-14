import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CLUB_RECHARGE_ERROR_CODE,
  clubRechargeError,
} from './club-recharge.errors';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import { buildOrderNo } from '../orders/club-order-drafts.utils';
import type {
  ClubOrderDraftPayload,
  ClubRechargeOrderMetadata,
} from '../orders/club-order-drafts.types';
import {
  type ClubRechargeOrderResponseDto,
  type ClubRechargePackageDto,
  type CreateClubRechargeOrderDto,
} from './dto/club-recharge.dto';
import { toClubRechargeOrderResponse } from './club-recharge.mapper';
import { ClubRechargePackagesService } from './club-recharge-packages.service';
import { ClubRechargeContextService } from './club-recharge-context.service';
import type { ResolvedRechargeOrderSelection } from './club-recharge.types';
import {
  CLUB_CUSTOM_AMOUNT_MAX,
  CLUB_CUSTOM_AMOUNT_MIN,
  CLUB_RECHARGE_PACKAGE_NOT_FOUND_MESSAGE,
} from './club-recharge.constants';
import { Money } from './club-recharge.utils';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import { ClubRechargeOrderStoreService } from './club-recharge-order-store.service';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';

/** 充值下单的幂等作用域（与团购券 / 服务订单区分开） */
const RECHARGE_ORDER_IDEMPOTENCY_SCOPE = 'club:recharge-order:create';

@Injectable()
export class ClubRechargeCreationService {
  private readonly logger = new Logger(ClubRechargeCreationService.name);

  constructor(
    private readonly clubRechargeContextService: ClubRechargeContextService,
    private readonly clubRechargePackagesService: ClubRechargePackagesService,
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
    private readonly clubWechatOpenidService: ClubWechatOpenidService,
    private readonly clubPaymentModeService: ClubPaymentModeService,
    private readonly clubRechargeOrderStoreService: ClubRechargeOrderStoreService,
    private readonly idempotencyService: ClubOrderIdempotencyService,
  ) {}

  async createOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubRechargeOrderDto,
    idempotencyKey?: string,
  ): Promise<ClubRechargeOrderResponseDto> {
    const idempotency = this.idempotencyService.normalizeKey(idempotencyKey);

    // 重复提交直接复用上一笔订单：否则双击一次就多一笔待支付单、多一次微信预下单。
    if (idempotency) {
      const existingOrderNo = await this.idempotencyService.findOrderNo({
        scope: RECHARGE_ORDER_IDEMPOTENCY_SCOPE,
        userId: currentContext.user.id,
        key: idempotency,
      });
      if (existingOrderNo) {
        return this.replayRechargeOrder(currentContext, existingOrderNo);
      }
    }

    this.assertSameCurrentStore(currentContext, dto.storeId);

    // 测试模式不向微信预下单：订单照常落 unpaid，前端由 confirm-paid 完成入账。
    // 门店收款校验随之跳过——它拦的是「真实收不到钱」，而测试模式本就不收钱，
    // 门店未配收款时继续校验只会把可走通的联调流程拦死。
    const skipWechatPrepay =
      await this.clubPaymentModeService.isManualConfirmPaidAllowed();

    // A1：下单前显式校验门店已配置微信收款。
    // 不校验的话门店没配收款时用户一路走到支付，最后只看到通用「支付失败」，
    // 既不知道是门店侧问题，也不知道该联系谁。
    if (!skipWechatPrepay) {
      await this.clubWechatJsapiService.assertStorePayConfigured(
        currentContext.store.id,
      );
    }

    const packages =
      await this.clubRechargePackagesService.loadPackagesForStore(
        currentContext.store.id,
      );

    // Bug 6 修复：先解析套餐再建档。
    // 此前 requireCurrentCustomer 跑在套餐校验之前，用户选中已下架套餐（或
    // packageId / customAmount 同时传入）时，下单虽然失败，却已经建好 / 认领了
    // 一条 marketingCustomer 档案，留下孤儿数据。建档是「确定要落账」的动作，
    // 必须放在所有前置校验之后。
    const selection = this.resolveRechargeOrderSelection(dto, packages);
    const customer =
      await this.clubRechargeContextService.requireCurrentCustomer(
        currentContext.store.id,
        currentContext.user.id,
        currentContext.user.phone,
      );

    // 预生成订单号以保证 JSAPI out_trade_no 与 draft orderNo 一致
    const now = Date.now();
    const orderNo = buildOrderNo('recharge', now);

    // 前端目前不下发 openid：显式传入时优先使用，未传则按 userId 回查
    // users.wechat_openid。不再依赖占位手机号还原——用户绑定真实手机号后
    // 占位值会被抹掉，那条路径会失效。
    const openid = await this.clubWechatOpenidService.resolveOpenid(
      currentContext.user.id,
      dto.openid,
    );
    // 断言在建草稿之前：缺 openid 时不应产生任何订单数据
    this.assertOpenidAvailable(openid, currentContext.store.id);

    // 占位必须先于建草稿：并发双击时第二个请求在这里命中已有订单号并直接复用，
    // 不会再建第二笔草稿，也不会再向微信发起第二次预下单。
    if (idempotency) {
      const occupiedOrderNo = await this.idempotencyService.reserve({
        scope: RECHARGE_ORDER_IDEMPOTENCY_SCOPE,
        userId: currentContext.user.id,
        key: idempotency,
        orderNo,
      });
      if (occupiedOrderNo) {
        return this.replayRechargeOrder(currentContext, occupiedOrderNo);
      }
    }

    try {
      return await this.createDraftAndPrepay({
        currentContext,
        selection,
        customerId: customer.id,
        openid,
        skipWechatPrepay,
        orderNo,
      });
    } catch (error) {
      // 建单失败必须释放占位，否则用户 15 分钟内用同一个键重试都拿不到新订单。
      if (idempotency) {
        await this.releaseIdempotency(currentContext.user.id, idempotency);
      }
      throw error;
    }
  }

  /**
   * 建草稿 → 微信 JSAPI 预下单 → 落库。
   * 抽成独立方法后 createOrder 只负责幂等编排与前置校验，避免单个函数继续膨胀。
   */
  private async createDraftAndPrepay(params: {
    currentContext: ClubCurrentContext;
    selection: ResolvedRechargeOrderSelection;
    customerId: number;
    openid: string | null;
    skipWechatPrepay: boolean;
    orderNo: string;
  }): Promise<ClubRechargeOrderResponseDto> {
    const { currentContext, selection, orderNo } = params;

    // 先创建草稿（含 mock 支付参数），再调用微信下单
    // 这样微信下单失败时可以删除草稿回滚，避免产生无法支付的孤立草稿
    let draft = await this.clubOrderDraftsService.createDraft<
      ClubRechargeOrderMetadata,
      'recharge'
    >({
      user: currentContext.user,
      orderType: 'recharge',
      storeId: currentContext.store.id,
      storeName: currentContext.store.name,
      customerId: params.customerId,
      title: '会员充值',
      amountFen: selection.rechargeAmountFen,
      metadata: selection,
      orderNo,
    });

    // 微信 JSAPI 下单：成功后更新草稿中的支付参数。
    // 测试模式跳过，草稿保持无支付参数，前端不拉起收银台。
    if (params.openid && !params.skipWechatPrepay) {
      try {
        const paymentParams =
          await this.clubWechatJsapiService.createJsapiPaymentParams({
            storeId: currentContext.store.id,
            orderNo,
            description: '会员充值',
            amountFen: selection.rechargeAmountFen,
            openid: params.openid,
          });
        draft = await this.clubOrderDraftsService.updateDraftPaymentParams(
          draft,
          paymentParams,
        );
      } catch (error) {
        // 微信下单失败，清理已创建的草稿避免产生死单
        await this.clubOrderDraftsService.deleteDraft(draft.id);
        throw error;
      }
    }

    // Redis 草稿只是加速层，订单必须同时落库：
    // 只存 Redis 时一旦重启 / 淘汰 / 过期，微信回调取不到订单，
    // 会出现「用户已付款、余额不到账且无法补单」的资金事故。
    await this.clubRechargeOrderStoreService.createPendingRecord(draft);

    return toClubRechargeOrderResponse(
      this.clubOrderDraftsService.toOrderStatusResponse(draft),
      draft,
    );
  }

  /** 幂等命中：原样返回上一笔订单，不新增返回字段，老前端零感知。 */
  private async replayRechargeOrder(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubRechargeOrderResponseDto> {
    let draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>;
    try {
      draft = await this.clubOrderDraftsService.getDraft<
        ClubRechargeOrderMetadata,
        'recharge'
      >(currentContext.user, orderNo, 'recharge');
    } catch {
      throw new ConflictException(
        clubRechargeError(
          CLUB_RECHARGE_ERROR_CODE.STATUS_REPLAY_CONFLICT,
          '充值订单已提交，请稍后在订单列表中查看',
        ),
      );
    }

    // 幂等键按用户维度占位，但用户可能在此期间切了门店；
    // 跨店复用旧订单会让钱进错商家账户，必须显式拒绝。
    if (draft.storeId !== currentContext.store.id) {
      throw new ConflictException(
        clubRechargeError(
          CLUB_RECHARGE_ERROR_CODE.RULE_STORE_CHANGED,
          '当前门店已变更，请重新发起充值',
        ),
      );
    }

    return toClubRechargeOrderResponse(
      this.clubOrderDraftsService.toOrderStatusResponse(draft),
      draft,
    );
  }

  /** 释放占位失败只记日志，不能覆盖建单本身的错误。 */
  private async releaseIdempotency(userId: number, key: string): Promise<void> {
    try {
      await this.idempotencyService.release({
        scope: RECHARGE_ORDER_IDEMPOTENCY_SCOPE,
        userId,
        key,
      });
    } catch (error) {
      this.logger.warn(
        `释放充值下单幂等键失败（不影响主错误，userId=${userId}）：${String(error)}`,
      );
    }
  }

  /**
   * openid 是 JSAPI 下单的必填项。
   *
   * 缺 openid 时草稿会带着开发态 mock 支付参数落库，前端拉起必然失败，
   * 表现为「下单成功但永远支付失败」。生产环境必须直接拒绝，
   * 宁可让用户重新进入小程序，也不要发出注定无效的订单。
   */
  private assertOpenidAvailable(openid: string | null, storeId: number): void {
    if (openid) {
      return;
    }

    if (this.clubPaymentModeService.isProduction()) {
      throw new BadRequestException(
        clubRechargeError(
          CLUB_RECHARGE_ERROR_CODE.PARAM_OPENID_MISSING,
          '未获取到微信支付身份，请重新进入小程序后重试',
        ),
      );
    }

    this.logger.warn(
      `开发态下单未拿到 openid（storeId=${storeId}），将使用 mock 支付参数`,
    );
  }

  private resolveRechargeOrderSelection(
    dto: CreateClubRechargeOrderDto,
    packages: ClubRechargePackageDto[],
  ): ResolvedRechargeOrderSelection {
    const hasPackageId =
      typeof dto.packageId === 'string' && dto.packageId.trim().length > 0;
    const hasCustomAmount = typeof dto.customAmount === 'number';

    if (hasPackageId === hasCustomAmount) {
      throw new BadRequestException(
        clubRechargeError(
          CLUB_RECHARGE_ERROR_CODE.PARAM_PACKAGE_AMOUNT_EXCLUSIVE,
          'packageId 和 customAmount 必须二选一',
        ),
      );
    }

    if (hasPackageId) {
      return this.resolvePackageSelection(dto.packageId!, packages);
    }

    return this.resolveCustomAmountSelection(dto.customAmount!);
  }

  private resolvePackageSelection(
    packageId: string,
    packages: ClubRechargePackageDto[],
  ): ResolvedRechargeOrderSelection {
    const matchedPackage = packages.find((item) => item.id === packageId);
    if (!matchedPackage) {
      throw new NotFoundException(
        clubRechargeError(
          CLUB_RECHARGE_ERROR_CODE.RESOURCE_PACKAGE_NOT_FOUND,
          CLUB_RECHARGE_PACKAGE_NOT_FOUND_MESSAGE,
        ),
      );
    }

    return {
      packageId: matchedPackage.id,
      promotionId: this.resolvePromotionIdFromPackageId(matchedPackage.id),
      rechargeAmountFen: Money.fromInputYuan(matchedPackage.amount).toDbCents(),
      bonusAmountFen: Money.fromInputYuan(
        matchedPackage.bonusAmount,
      ).toDbCents(),
      customAmountFen: null,
    };
  }

  private resolveCustomAmountSelection(
    customAmount: number,
  ): ResolvedRechargeOrderSelection {
    if (
      customAmount < CLUB_CUSTOM_AMOUNT_MIN ||
      customAmount > CLUB_CUSTOM_AMOUNT_MAX
    ) {
      throw new BadRequestException(
        clubRechargeError(
          CLUB_RECHARGE_ERROR_CODE.PARAM_CUSTOM_AMOUNT_OUT_OF_RANGE,
          `自定义充值金额需在 ${CLUB_CUSTOM_AMOUNT_MIN}-${CLUB_CUSTOM_AMOUNT_MAX} 元之间`,
        ),
      );
    }

    return {
      packageId: null,
      promotionId: null,
      rechargeAmountFen: Money.fromInputYuan(customAmount).toDbCents(),
      bonusAmountFen: 0,
      customAmountFen: Money.fromInputYuan(customAmount).toDbCents(),
    };
  }

  private resolvePromotionIdFromPackageId(packageId: string): number | null {
    const matched = /^(\d+)(?::\d+)?$/.exec(packageId.trim());
    if (!matched) {
      return null;
    }

    return Number.parseInt(matched[1], 10);
  }

  private assertSameCurrentStore(
    currentContext: ClubCurrentContext,
    requestedStoreId: number,
  ): void {
    if (currentContext.store.id !== requestedStoreId) {
      throw new BadRequestException(
        clubRechargeError(
          CLUB_RECHARGE_ERROR_CODE.RULE_STORE_CHANGED,
          '当前门店已切换，请刷新页面后重试',
        ),
      );
    }
  }
}
