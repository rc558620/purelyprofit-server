import { ConflictException, Injectable } from '@nestjs/common';
import { CLUB_ORDER_ERROR_CODE, clubOrderError } from './club-orders.errors';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import { settleClubTasksInOrder } from '../shared/club-parallel-settle.helper';
import { buildOrderNo } from './club-order-drafts.utils';
import type { ClubServiceOrderMetadata } from './club-order-drafts.types';
import { resolvePointsDeduction } from './club-order-points.utils';
import type { ClubServicePricingResolution } from './club-order-promotions.service';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import type { ClubCreateServiceOrderContext } from './club-order-service-context.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import { MembershipDowngradeService } from '../../purely-profit/member/platform-membership/membership-downgrade.service';
import { MEMBER_ZONE_ORDER_BLOCKED_MESSAGE } from '../../purely-profit/member/platform-membership/membership-downgrade.messages';
import { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import type {
  ClubServiceOrderResponseDto,
  ClubWechatPaymentParamsDto,
  CreateClubServiceOrderDto,
} from './dto/club-order.dto';

/** 服务购买订单的幂等作用域（与团购券订单区分开） */
const SERVICE_ORDER_IDEMPOTENCY_SCOPE = 'club:service-order:create';

/** 建单算价结果（金额口径全部在此固化，后续落库/预下单只读） */
interface ClubServiceOrderAmounts {
  pricing: ClubServicePricingResolution;
  quantity: number;
  orderReduceFen: number;
  pointsDeductFen: number;
  pointsUsed: number;
  finalAmountFen: number;
}

/** 落草稿所需参数（对象入参，避免长参数列表） */
interface PersistServiceOrderParams {
  currentContext: ClubCurrentContext;
  context: ClubCreateServiceOrderContext;
  amounts: ClubServiceOrderAmounts;
  orderNo: string;
  paymentParams?: ClubWechatPaymentParamsDto;
}

@Injectable()
export class ClubOrderServiceCreationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
    private readonly clubOrderServiceContextService: ClubOrderServiceContextService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
    private readonly clubWechatOpenidService: ClubWechatOpenidService,
    private readonly clubPaymentModeService: ClubPaymentModeService,
    private readonly downgradeService: MembershipDowngradeService,
    private readonly quotaService: ClubNewCustomerQuotaService,
    private readonly idempotencyService: ClubOrderIdempotencyService,
  ) {}

  /**
   * 创建服务购买订单。
   *
   * 串行段只剩「真正有依赖」的部分；互不依赖的分支用
   * `settleClubTasksInOrder` 并行，且错误优先级与改前串行完全一致。
   */
  async createServiceOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubServiceOrderDto,
    idempotencyKey?: string,
  ): Promise<ClubServiceOrderResponseDto> {
    const idempotency = this.idempotencyService.normalizeKey(idempotencyKey);

    // 重复提交直接复用上一笔订单：否则双击一次就多一单、多扣一次新客额度
    if (idempotency) {
      const existingOrderNo = await this.idempotencyService.findOrderNo({
        scope: SERVICE_ORDER_IDEMPOTENCY_SCOPE,
        userId: currentContext.user.id,
        key: idempotency,
      });
      if (existingOrderNo) {
        return this.replayServiceOrder(currentContext, existingOrderNo);
      }
    }

    const context = await this.resolveOrderContext(currentContext, dto);

    // 两条互不依赖的分支并行：
    // 1) 活动快照 → 算价 → 满减 → 积分抵扣（新客额度闸门在其内部与快照并行）；
    // 2) 支付模式判定 → openid 解析（与金额无关）。
    // 金额分支的异常优先抛出，与改前「先算完价再解析 openid」的顺序一致。
    const [amounts, prepayOpenid] = await settleClubTasksInOrder([
      this.resolveOrderAmounts(context, currentContext, dto),
      this.resolvePrepayOpenid(currentContext, dto),
    ]);

    const orderNo = buildOrderNo('service', Date.now());

    // 并发双击：同一幂等键只允许一笔真正落到草稿，后到者复用先到的订单
    if (idempotency) {
      const occupiedOrderNo = await this.idempotencyService.reserve({
        scope: SERVICE_ORDER_IDEMPOTENCY_SCOPE,
        userId: currentContext.user.id,
        key: idempotency,
        orderNo,
      });
      if (occupiedOrderNo && occupiedOrderNo !== orderNo) {
        return this.replayServiceOrder(currentContext, occupiedOrderNo);
      }
    }

    try {
      // 微信 JSAPI 预下单是远程调用，必须在落草稿之前完成（事务内禁止远程调用）。
      // 它依赖 finalAmountFen 与 openid，因此只能在两分支都结算后串行执行。
      const paymentParams = prepayOpenid
        ? await this.clubWechatJsapiService.createJsapiPaymentParams({
            storeId: context.store.id,
            orderNo,
            description: `购买${context.product.name}`,
            amountFen: amounts.finalAmountFen,
            openid: prepayOpenid,
          })
        : undefined;

      return await this.persistServiceOrder({
        currentContext,
        context,
        amounts,
        orderNo,
        paymentParams,
      });
    } catch (error) {
      await this.releaseAfterFailure(idempotency, orderNo, currentContext);
      throw error;
    }
  }

  /**
   * 门店到期闸门 ∥ 下单上下文解析。
   *
   * 两者都只依赖 `currentContext` / `dto`：闸门读的是门店会员缓存，
   * 上下文解析打两次 DB，串行纯属浪费一次往返。
   * 错误优先级保持「到期拦截优先」，与改前一致。
   */
  private async resolveOrderContext(
    currentContext: ClubCurrentContext,
    dto: CreateClubServiceOrderDto,
  ): Promise<ClubCreateServiceOrderContext> {
    // 会员过期门店停止会员专区的服务购买（无"在途"概念，一律拦截）
    const [, context] = await settleClubTasksInOrder([
      this.downgradeService.assertStoreCanOrder(
        currentContext.store.id,
        MEMBER_ZONE_ORDER_BLOCKED_MESSAGE,
      ),
      this.clubOrderServiceContextService.resolveCreateServiceOrderContext(
        currentContext,
        dto,
      ),
    ]);

    return context;
  }

  /**
   * 新客额度闸门 ∥ 活动快照预加载 → 算价 → 满减 → 积分抵扣。
   *
   * 额度闸门与活动快照只共享 `context`，彼此无依赖。
   * 闸门异常优先抛出（改前是「闸门拦下就不再算价」，语义保持：
   * 现在只是把快照预加载提前发起，被拦时多一次缓存读，不产生任何写）。
   */
  private async resolveOrderAmounts(
    context: ClubCreateServiceOrderContext,
    currentContext: ClubCurrentContext,
    dto: CreateClubServiceOrderDto,
  ): Promise<ClubServiceOrderAmounts> {
    const quantity = dto.quantity ?? 1;

    // 新客额度闸门：新客在额度耗尽时禁止下单，与扫码点餐同一口径
    const [, pricingContext] = await settleClubTasksInOrder([
      this.quotaService.assertAvailableForOrder(
        context.store.id,
        currentContext.user.id,
      ),
      // 整单只加载一次活动快照：行级定价与订单级满减共用，避免重复加载与口径漂移
      this.clubOrderPromotionsService.preloadPricingContext(
        context.store.id,
        context.customer.id,
      ),
    ]);

    const pricing = await this.clubOrderPromotionsService.resolvePricing(
      context.store.id,
      context.customer.id,
      context.product.price,
      { skipReduce: true, context: pricingContext },
    );

    // ── 订单级金额计算 ──
    const beforeReduceTotalFen = pricing.amountFenBeforeReduce * quantity;

    // 满减：基于订单总额计算，单次生效，不叠加
    const orderReduceFen =
      await this.clubOrderPromotionsService.resolveOrderReduceFen(
        context.store.id,
        beforeReduceTotalFen,
        pricingContext.promotions,
      );

    const afterReduceTotalFen = Math.max(
      beforeReduceTotalFen - orderReduceFen,
      0,
    );

    // ── 积分抵扣计算 ──
    // 根据会员等级配置中的积分规则进行计算（含 DB 查询，preview/creation 共用）
    const { pointsDeductFen, pointsUsed } = await resolvePointsDeduction(
      this.prisma,
      currentContext.store.id,
      context.customer.id,
      afterReduceTotalFen,
      dto.usePoints === true,
    );
    const finalAmountFen = Math.max(afterReduceTotalFen - pointsDeductFen, 0);

    return {
      pricing,
      quantity,
      orderReduceFen,
      pointsDeductFen,
      pointsUsed,
      finalAmountFen,
    };
  }

  /**
   * 支付模式判定 → openid 解析（与算价完全无关，可并行）。
   *
   * 测试模式不向微信预下单：订单照常落 unpaid，前端改由 confirm-paid 结算。
   * 预下单要求门店已配置微信收款，门店没配时会抛 STORE_PAY_CONFIG_MISSING，
   * 而测试模式根本用不到支付参数，不该被这一步拦死在建单阶段。
   * 因此必须先判模式，再决定是否解析 openid（与改前顺序一致）。
   * 解析不到 openid 时不调起真实微信支付，与其余链路同口径由前端兜底。
   */
  private async resolvePrepayOpenid(
    currentContext: ClubCurrentContext,
    dto: CreateClubServiceOrderDto,
  ): Promise<string | null> {
    const skipWechatPrepay =
      await this.clubPaymentModeService.isManualConfirmPaidAllowed();
    if (skipWechatPrepay) {
      return null;
    }

    return this.clubWechatOpenidService.resolveOpenid(
      currentContext.user.id,
      dto.openid,
    );
  }

  /**
   * 落草稿 → 扣新客额度 → 组装响应。
   *
   * 服务商品草稿只存 Redis、不落数据库，扣减无法与建单共用事务，
   * 因此用「先落草稿 → 扣额度 → 扣不到就撤销草稿」的补偿顺序保证等价的一致性：
   * 扣不到额度时草稿被删除、订单不成立，服务的新客数与扣掉的额度仍然严格相等。
   * 进程崩溃会留下一个没扣到额度的草稿，它自带 TTL 会自动过期，不会造成多扣。
   */
  private async persistServiceOrder(
    params: PersistServiceOrderParams,
  ): Promise<ClubServiceOrderResponseDto> {
    const { currentContext, context, amounts, orderNo, paymentParams } = params;

    const draft = await this.clubOrderDraftsService.createDraft({
      user: currentContext.user,
      orderType: 'service',
      storeId: context.store.id,
      storeName: context.store.name,
      customerId: context.customer.id,
      title: `购买${context.product.name}`,
      amountFen: amounts.finalAmountFen,
      metadata: this.clubOrderServiceContextService.buildDraftMetadata(
        context.product,
        {
          ...amounts.pricing,
          totalReduceFen: amounts.orderReduceFen,
          // 订单总优惠 = 单件活动优惠 × 数量 + 整单满减（单次），保证与原价、应付勾稽
          discountAmountFen:
            amounts.pricing.discountAmountFen * amounts.quantity +
            amounts.orderReduceFen,
        },
        amounts.pointsDeductFen,
        amounts.pointsUsed,
        amounts.quantity,
      ),
      orderNo,
      paymentParams,
    });

    await this.quotaService.consumeForOrder(
      context.store.id,
      currentContext.user.id,
      currentContext.user.phone || null,
    );

    return this.clubOrderDraftsService.toServiceOrderResponse(draft);
  }

  /**
   * 失败清理：草稿删掉（它自带 TTL，删失败也无害），幂等键释放掉，
   * 否则用户 15 分钟内用同一个键重试都只会拿到「处理中」。
   */
  private async releaseAfterFailure(
    idempotency: string | null,
    orderNo: string,
    currentContext: ClubCurrentContext,
  ): Promise<void> {
    try {
      await this.clubOrderDraftsService.deleteDraft(orderNo);
    } catch {
      // 清理失败不影响主错误，草稿本身有 TTL 兜底
    }

    if (!idempotency) {
      return;
    }

    try {
      await this.idempotencyService.release({
        scope: SERVICE_ORDER_IDEMPOTENCY_SCOPE,
        userId: currentContext.user.id,
        key: idempotency,
      });
    } catch {
      // 释放失败只会让对方多等一个 TTL，不影响已抛出的业务错误
    }
  }

  /**
   * 幂等命中：把上一次已创建的草稿原样返回。
   *
   * 草稿只活 15 分钟，过期后再拿同一个键重试时已经没有可复用的订单，
   * 此时明确提示「已提交、去订单列表看」，而不是悄悄再建一单。
   */
  private async replayServiceOrder(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubServiceOrderResponseDto> {
    try {
      const draft = await this.clubOrderDraftsService.getDraft<
        ClubServiceOrderMetadata,
        'service'
      >(currentContext.user, orderNo, 'service');
      // 标记复用：前端据此跳过「再次调起收银台 / confirmPaid」，
      // 否则重复点击会把一次下单意图结算两遍
      return {
        ...this.clubOrderDraftsService.toServiceOrderResponse(draft),
        reused: true,
      };
    } catch {
      throw new ConflictException(
        clubOrderError(
          CLUB_ORDER_ERROR_CODE.STATUS_REPLAY_CONFLICT,
          '订单已提交，请稍后在订单列表中查看',
        ),
      );
    }
  }
}
