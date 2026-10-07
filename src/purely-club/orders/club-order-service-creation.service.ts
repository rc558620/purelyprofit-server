import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { buildOrderNo } from './club-order-drafts.utils';
import { resolvePointsDeduction } from './club-order-points.utils';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import {
  MembershipDowngradeService,
  MEMBER_ZONE_ORDER_BLOCKED_MESSAGE,
} from '../../purely-profit/member/platform-membership/membership-downgrade.service';
import { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import type {
  ClubServiceOrderResponseDto,
  CreateClubServiceOrderDto,
} from './dto/club-order.dto';

@Injectable()
export class ClubOrderServiceCreationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
    private readonly clubOrderServiceContextService: ClubOrderServiceContextService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
    private readonly downgradeService: MembershipDowngradeService,
    private readonly quotaService: ClubNewCustomerQuotaService,
  ) {}

  async createServiceOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubServiceOrderDto,
  ): Promise<ClubServiceOrderResponseDto> {
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

    // 若前端传入 openid，则调用微信 JSAPI 真实下单
    const paymentParams = dto.openid
      ? await this.clubWechatJsapiService.createJsapiPaymentParams({
          storeId: context.store.id,
          orderNo,
          description: `购买${productName}`,
          amountFen: finalAmountFen,
          openid: dto.openid,
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
    try {
      await this.quotaService.consumeForOrder(
        context.store.id,
        currentContext.user.id,
        currentContext.user.phone || null,
      );
    } catch (error) {
      // 撤销草稿失败不能吞掉额度错误：草稿带 TTL 会自行过期，
      // 而额度错误必须让用户看到「为什么下不了单」。
      await this.clubOrderDraftsService
        .deleteDraft(orderNo)
        .catch(() => undefined);
      throw error;
    }

    return this.clubOrderDraftsService.toServiceOrderResponse(draft);
  }
}
