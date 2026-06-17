import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { buildOrderNo } from './club-order-drafts.utils';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import { CLUB_POINTS_MAX_DEDUCT_RATIO } from './club-orders.constants';
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
    );
    const productName = context.product.name;

    // ── 积分抵扣计算 ──────────────────────────────────────────────────────────
    // 规则：1 积分 = 1 元（100 分），最多可抵扣折后价的 50%
    const { pointsDeductFen, pointsUsed } = await this.calcPointsDeduction(
      currentContext.store.id,
      currentContext.user.phone,
      pricing.amountFen,
      dto.usePoints === true,
    );
    const finalAmountFen = Math.max(pricing.amountFen - pointsDeductFen, 0);

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
        pricing,
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
   * 规则：1 积分 = 100 分（即 1 元），最多抵扣折后价的 50%
   */
  private async calcPointsDeduction(
    storeId: number,
    phone: string,
    priceAfterDiscountFen: number,
    usePoints: boolean,
  ): Promise<{ pointsDeductFen: number; pointsUsed: number }> {
    if (!usePoints || priceAfterDiscountFen <= 0) {
      return { pointsDeductFen: 0, pointsUsed: 0 };
    }

    const customer = await this.prisma.marketingCustomer.findUnique({
      where: { storeId_phone: { storeId, phone } },
      select: { points: true },
    });

    const availablePoints = customer?.points ?? 0;
    if (availablePoints <= 0) {
      return { pointsDeductFen: 0, pointsUsed: 0 };
    }

    // 最多可抵扣金额（分）= 折后价 × 50%，向下取整到整分
    const maxDeductFen = Math.floor(
      new Decimal(priceAfterDiscountFen)
        .mul(CLUB_POINTS_MAX_DEDUCT_RATIO)
        .toNumber(),
    );

    // 1 积分 = 100 分（1 元），可用积分对应的抵扣金额
    const availableDeductFen = availablePoints * 100;

    const pointsDeductFen = Math.min(maxDeductFen, availableDeductFen);
    // 实际消耗积分 = 抵扣分数 ÷ 100（向上取整避免少扣）
    const pointsUsed = Math.ceil(pointsDeductFen / 100);

    return { pointsDeductFen, pointsUsed };
  }

}
