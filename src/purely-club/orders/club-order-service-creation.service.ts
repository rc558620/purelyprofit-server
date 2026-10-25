import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubWechatOpenidService } from '../payments/club-wechat-openid.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import { buildOrderNo } from './club-order-drafts.utils';
import type { ClubServiceOrderMetadata } from './club-order-drafts.types';
import { resolvePointsDeduction } from './club-order-points.utils';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import { MembershipDowngradeService } from '../../purely-profit/member/platform-membership/membership-downgrade.service';
import { MEMBER_ZONE_ORDER_BLOCKED_MESSAGE } from '../../purely-profit/member/platform-membership/membership-downgrade.messages';
import { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import type {
  ClubServiceOrderResponseDto,
  CreateClubServiceOrderDto,
} from './dto/club-order.dto';

/** 服务购买订单的幂等作用域（与团购券订单区分开） */
const SERVICE_ORDER_IDEMPOTENCY_SCOPE = 'club:service-order:create';

@Injectable()
export class ClubOrderServiceCreationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
    private readonly clubOrderServiceContextService: ClubOrderServiceContextService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
    private readonly clubWechatOpenidService: ClubWechatOpenidService,
    private readonly downgradeService: MembershipDowngradeService,
    private readonly quotaService: ClubNewCustomerQuotaService,
    private readonly idempotencyService: ClubOrderIdempotencyService,
  ) {}

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

    // 会员过期门店停止会员专区的服务购买（无"在途"概念，一律拦截）
    await this.downgradeService.assertStoreCanOrder(
      currentContext.store.id,
      MEMBER_ZONE_ORDER_BLOCKED_MESSAGE,
    );

    const context =
      await this.clubOrderServiceContextService.resolveCreateServiceOrderContext(
        currentContext,
        dto,
      );

    // 新客额度闸门：新客在额度耗尽时禁止下单，与扫码点餐同一口径。
    // 放在算价之前——被拦时不必白算一轮促销与积分。
    // 额度归属取本次下单所在门店（context 已校验等于当前门店）：该顾客若尚未在
    // 任何门店消耗过额度，就由这家门店承担额度；已在别家店认证过则直接放行。
    await this.quotaService.assertAvailableForOrder(
      context.store.id,
      currentContext.user.id,
    );

    const pricing = await this.clubOrderPromotionsService.resolvePricing(
      context.store.id,
      context.customer.id,
      context.product.price,
      { skipReduce: true },
    );
    const productName = context.product.name;
    const quantity = dto.quantity ?? 1;

    // ── 订单级金额计算 ──
    const beforeReduceTotalFen = pricing.amountFenBeforeReduce * quantity;

    // 满减：基于订单总额计算，单次生效，不叠加
    const orderReduceFen =
      await this.clubOrderPromotionsService.resolveOrderReduceFen(
        context.store.id,
        beforeReduceTotalFen,
      );

    const afterReduceTotalFen = Math.max(
      beforeReduceTotalFen - orderReduceFen,
      0,
    );

    // ── 积分抵扣计算 ──────────────────────────────────────────────────────────
    // 根据会员等级配置中的积分规则进行计算（含 DB 查询，preview/creation 共用）
    const { pointsDeductFen, pointsUsed } = await resolvePointsDeduction(
      this.prisma,
      currentContext.store.id,
      context.customer.id,
      afterReduceTotalFen,
      dto.usePoints === true,
    );
    const finalAmountFen = Math.max(afterReduceTotalFen - pointsDeductFen, 0);

    // 预生成订单号保证 JSAPI out_trade_no 与 draft orderNo 一致
    const now = Date.now();
    const orderNo = buildOrderNo('service', now);

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
      // 解析 openid：显式传入优先，未传则按 userId 回查 users.wechat_openid。
      // 解析不到时不调起真实微信支付，与其余链路同口径由前端兜底。
      const openid = await this.clubWechatOpenidService.resolveOpenid(
        currentContext.user.id,
        dto.openid,
      );
      const paymentParams = openid
        ? await this.clubWechatJsapiService.createJsapiPaymentParams({
            storeId: context.store.id,
            orderNo,
            description: `购买${productName}`,
            amountFen: finalAmountFen,
            openid,
          })
        : undefined;

      const draft = await this.clubOrderDraftsService.createDraft({
        user: currentContext.user,
        orderType: 'service',
        storeId: context.store.id,
        storeName: context.store.name,
        customerId: context.customer.id,
        title: `购买${productName}`,
        amountFen: finalAmountFen,
        metadata: this.clubOrderServiceContextService.buildDraftMetadata(
          context.product,
          {
            ...pricing,
            totalReduceFen: orderReduceFen,
            // 订单总优惠 = 单件活动优惠 × 数量 + 整单满减（单次），保证与原价、应付勾稽
            discountAmountFen:
              pricing.discountAmountFen * quantity + orderReduceFen,
          },
          pointsDeductFen,
          pointsUsed,
          quantity,
        ),
        orderNo,
        paymentParams,
      });

      // 服务商品草稿只存 Redis、不落数据库，扣减无法与建单共用事务，
      // 因此用「先落草稿 → 扣额度 → 扣不到就撤销草稿」的补偿顺序保证等价的一致性：
      // 扣不到额度时草稿被删除、订单不成立，服务的新客数与扣掉的额度仍然严格相等。
      // 进程崩溃会留下一个没扣到额度的草稿，它自带 TTL 会自动过期，不会造成多扣。
      await this.quotaService.consumeForOrder(
        context.store.id,
        currentContext.user.id,
        currentContext.user.phone || null,
      );

      return this.clubOrderDraftsService.toServiceOrderResponse(draft);
    } catch (error) {
      // 建单失败必须清干净：草稿删掉（它自带 TTL，删失败也无害），
      // 幂等键释放掉，否则用户 15 分钟内用同一个键重试都只会拿到「处理中」
      try {
        await this.clubOrderDraftsService.deleteDraft(orderNo);
      } catch {
        // 清理失败不影响主错误，草稿本身有 TTL 兜底
      }

      if (idempotency) {
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

      throw error;
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
      throw new ConflictException('订单已提交，请稍后在订单列表中查看');
    }
  }
}
