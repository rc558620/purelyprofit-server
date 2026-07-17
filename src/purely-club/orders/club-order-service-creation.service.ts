import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { buildOrderNo } from './club-order-drafts.utils';
import {
  fetchPointsRedeemConfig,
  calcPointsRedeemDetail,
} from './club-order-points.utils';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
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
  ) {}

  async createServiceOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubServiceOrderDto,
  ): Promise<ClubServiceOrderResponseDto> {
    const context =
      await this.clubOrderServiceContextService.resolveCreateServiceOrderContext(
        currentContext,
        dto,
      );
    const pricing = await this.clubOrderPromotionsService.resolvePricing(
      context.store.id,
      context.customer.id,
      currentContext.user.phone,
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
    // 根据会员等级配置中的积分规则进行计算
    // 复用 context.customer.id 查询积分，避免重复通过 storeId+phone 查询 marketingCustomer
    const { pointsDeductFen, pointsUsed } = await this.calcPointsDeduction(
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
          discountAmountFen: pricing.discountAmountFen + orderReduceFen,
        },
        pointsDeductFen,
        pointsUsed,
        quantity,
      ),
      orderNo,
      paymentParams,
    });

    return this.clubOrderDraftsService.toServiceOrderResponse(draft);
  }

  /**
   * 计算积分抵扣金额
   * 根据 marketingMemberLevelSettings 中的积分规则动态计算：
   * - redeemRatioPoints: 多少积分抵扣 1 元
   * - maxRedeemRatio: 单次消费最大积分抵扣比例（0-1）
   *
   * ════════════════════════════════════════════════════════════════
   *  ⚠️  项目设计决策（禁止修改）：
   *      积分抵扣不受 enabled 开关限制。
   *      即使 enabled=false，只要用户有积分且 redeemRatioPoints/maxRedeemRatio
   *      配置正常，就允许抵扣。
   *      禁止在此方法中重新引入 !pointsConfig.enabled 拦截逻辑。
   * ════════════════════════════════════════════════════════════════
   */
  private async calcPointsDeduction(
    storeId: number,
    customerId: number,
    priceAfterDiscountFen: number,
    usePoints: boolean,
  ): Promise<{ pointsDeductFen: number; pointsUsed: number }> {
    if (!usePoints || priceAfterDiscountFen <= 0) {
      return { pointsDeductFen: 0, pointsUsed: 0 };
    }

    // ⚠️ 注意：fetchPointsRedeemConfig 返回的 enabled 字段在此处被有意忽略。
    // 详见上方 JSDoc「项目设计决策」说明。仅取 redeemRatioPoints / maxRedeemRatio。
    const pointsConfig = await fetchPointsRedeemConfig(this.prisma, storeId);

    const customer = await this.prisma.marketingCustomer.findUnique({
      where: { id: customerId },
      select: { points: true },
    });

    const availablePoints = customer?.points ?? 0;

    return calcPointsRedeemDetail(
      priceAfterDiscountFen,
      pointsConfig,
      availablePoints,
    );
  }
}
