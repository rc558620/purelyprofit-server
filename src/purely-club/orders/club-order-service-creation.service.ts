import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { buildOrderNo } from './club-order-drafts.utils';
import type { ClubPointsRedeemConfig } from './club-order-drafts.utils';
import { resolvePointsRedeemConfig } from './club-order-drafts.utils';
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
   * - enabled: 积分规则是否启用
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

    // 获取积分规则配置（仅取抵扣比例和兑换比率，不受 enabled 开关控制）
    const pointsRatio = await this.getPointsRatioConfig(storeId);

    // 通过 customerId 直接查询积分，避免重复通过 storeId+phone 查询
    const customer = await this.prisma.marketingCustomer.findUnique({
      where: { id: customerId },
      select: { points: true },
    });

    const availablePoints = customer?.points ?? 0;
    if (availablePoints <= 0) {
      return { pointsDeductFen: 0, pointsUsed: 0 };
    }

    // 最多可抵扣金额（分）= 折后价 × 配置的抵扣比例上限，向下取整到整分
    const maxDeductFen = Math.floor(
      new Decimal(priceAfterDiscountFen)
        .mul(pointsRatio.maxRedeemRatio)
        .toNumber(),
    );

    // 1 积分对应的抵扣金额（分）= 100 / redeemRatioPoints
    // 例如 redeemRatioPoints=100 表示 100 积分 = 1 元，即 1 积分 = 1 分
    // 例如 redeemRatioPoints=50 表示 50 积分 = 1 元，即 1 积分 = 2 分
    const pointsToFenRatio = 100 / pointsRatio.redeemRatioPoints;
    const availableDeductFen = availablePoints * pointsToFenRatio;

    const pointsDeductFen = Math.min(maxDeductFen, availableDeductFen);
    // 实际消耗积分 = 抵扣分数 ÷ 积分汇率，向上取整避免少扣
    const pointsUsed = Math.ceil(pointsDeductFen / pointsToFenRatio);

    return { pointsDeductFen, pointsUsed };
  }

  /**
   * 获取积分抵扣配置
   * 从 marketingMemberLevelSetting 中读取，若未配置则使用默认值。
   * 若存在活跃的 points_recharge 活动，强制 enabled=true（与 Admin GET 保持一致）。
   */
  private async getPointsRatioConfig(
    storeId: number,
  ): Promise<ClubPointsRedeemConfig> {
    const settings = await this.prisma.marketingMemberLevelSetting.findUnique({
      where: { storeId },
      select: { pointsRatio: true },
    });

    const config = resolvePointsRedeemConfig(settings?.pointsRatio);

    if (!config.enabled) {
      const now = new Date();
      const promo = await this.prisma.marketingPromotion.findFirst({
        where: {
          storeId,
          type: 'points_recharge',
          enabled: true,
          startAt: { lte: now },
          endAt: { gte: now },
        },
        select: { id: true },
      });
      if (promo) {
        return { ...config, enabled: true };
      }
    }

    return config;
  }
}
