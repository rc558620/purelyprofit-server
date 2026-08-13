import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { buildOrderNo } from './club-order-drafts.utils';
import { resolvePointsDeduction } from './club-order-points.utils';
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

    return this.clubOrderDraftsService.toServiceOrderResponse(draft);
  }
}
