import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import { buildOrderNo } from '../orders/club-order-drafts.utils';
import type { ClubRechargeOrderMetadata } from '../orders/club-order-drafts.types';
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
  ) {}

  async createOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubRechargeOrderDto,
  ): Promise<ClubRechargeOrderResponseDto> {
    this.assertSameCurrentStore(currentContext, dto.storeId);

    // A1：下单前显式校验门店已配置微信收款。
    // 不校验的话门店没配收款时用户一路走到支付，最后只看到通用「支付失败」，
    // 既不知道是门店侧问题，也不知道该联系谁。
    await this.clubWechatJsapiService.assertStorePayConfigured(
      currentContext.store.id,
    );

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
      customerId: customer.id,
      title: '会员充值',
      amountFen: selection.rechargeAmountFen,
      metadata: selection,
      orderNo,
    });

    // 微信 JSAPI 下单：成功后更新草稿中的支付参数
    if (openid) {
      try {
        const paymentParams =
          await this.clubWechatJsapiService.createJsapiPaymentParams({
            storeId: currentContext.store.id,
            orderNo,
            description: '会员充值',
            amountFen: selection.rechargeAmountFen,
            openid,
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
        '未获取到微信支付身份，请重新进入小程序后重试',
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
      throw new BadRequestException('packageId 和 customAmount 必须二选一');
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
      throw new NotFoundException(CLUB_RECHARGE_PACKAGE_NOT_FOUND_MESSAGE);
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
        `自定义充值金额需在 ${CLUB_CUSTOM_AMOUNT_MIN}-${CLUB_CUSTOM_AMOUNT_MAX} 元之间`,
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
      throw new BadRequestException('当前门店已切换，请刷新页面后重试');
    }
  }
}
