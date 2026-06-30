import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Money } from '../../shared/money.utils';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubOrderBreakdownItemDto,
  ClubServiceOrderPreviewResponseDto,
  PreviewClubServiceOrderDto,
} from './dto/club-order.dto';
import type { ClubPointsRedeemConfig } from './club-order-drafts.utils';
import { resolvePointsRedeemConfig } from './club-order-drafts.utils';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClubOrderPreviewService {
  constructor(
    private readonly clubOrderServiceContextService: ClubOrderServiceContextService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
    private readonly prisma: PrismaService,
  ) {}

  async previewServiceOrder(
    currentContext: ClubCurrentContext,
    dto: PreviewClubServiceOrderDto,
  ): Promise<ClubServiceOrderPreviewResponseDto> {
    const context =
      await this.clubOrderServiceContextService.resolveCreateServiceOrderContext(
        currentContext,
        {
          storeId: dto.storeId,
          productId: dto.productId,
        },
      );

    const pricing = await this.clubOrderPromotionsService.resolvePricing(
      context.store.id,
      context.customer.id,
      currentContext.user.phone,
      context.product.price,
    );

    const quantity = dto.quantity ?? 1;

    const originalPriceFen =
      (context.product.originalPrice ?? context.product.price) * quantity;
    const finalPriceFen = pricing.amountFen * quantity;
    const afterDiscountFen = finalPriceFen + pricing.totalReduceFen * quantity;

    // 积分抵扣计算（基于乘以数量后的金额）
    const { pointsDeductFen, pointsUsed } = await this.calcPointsDeduction(
      currentContext.store.id,
      context.customer.id,
      finalPriceFen,
      dto.usePoints === true,
    );

    const afterPointsPriceFen = Money.fromDbCents(finalPriceFen)
      .subtractClampedToZero(Money.fromDbCents(pointsDeductFen))
      .toDbCents();

    const totalSavingAmount = Money.fromDbCents(originalPriceFen)
      .subtractClampedToZero(Money.fromDbCents(finalPriceFen))
      .toOutputYuan();

    const memberDiscountRate =
      await this.clubOrderPromotionsService.resolveMemberDiscountRate(
        context.store.id,
        currentContext.user.phone,
      );

    const breakdownItems = this.buildBreakdownItems({
      memberBaselineFen: pricing.memberBaselineFen * quantity,
      discountAmountFen: pricing.discountAmountFen * quantity,
      promotionDiscountAmountFen: pricing.promotionDiscountAmountFen * quantity,
      promotionType: pricing.promotionType,
      promotionTag: pricing.promotionTag,
      totalReduceFen: pricing.totalReduceFen * quantity,
      finalPriceFen,
      pointsDeductFen,
      memberDiscountRate,
    });

    return {
      originalPrice: Money.fromDbCents(originalPriceFen).toOutputYuan(),
      memberBaselinePrice: Money.fromDbCents(
        pricing.memberBaselineFen * quantity,
      ).toOutputYuan(),
      afterDiscountPrice: Money.fromDbCents(afterDiscountFen).toOutputYuan(),
      reduceAmount: Money.fromDbCents(pricing.totalReduceFen * quantity).toOutputYuan(),
      finalPrice: Money.fromDbCents(finalPriceFen).toOutputYuan(),
      totalSavingAmount,
      pointsDeductionAmount: Money.fromDbCents(pointsDeductFen).toOutputYuan(),
      pointsUsed,
      afterPointsPrice: Money.fromDbCents(afterPointsPriceFen).toOutputYuan(),
      promotionId:
        pricing.promotionId !== null ? String(pricing.promotionId) : null,
      promotionType: pricing.promotionType,
      discountRate: pricing.discountRate,
      promotionTag: pricing.promotionTag,
      quantity,
      breakdownItems,
    };
  }

  /**
   * 计算积分抵扣金额：预览接口始终计算可抵扣金额（不受 enabled 开关限制），
   * 前端根据 usePoints 决定是否展示；实际下单时仍由 creation service 管控 enabled。
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

    const pointsRatio = await this.getPointsRatioConfig(storeId);

    if (pointsRatio.redeemRatioPoints <= 0 || pointsRatio.maxRedeemRatio <= 0) {
      return { pointsDeductFen: 0, pointsUsed: 0 };
    }

    const customer = await this.prisma.marketingCustomer.findUnique({
      where: { id: customerId },
      select: { points: true },
    });

    const availablePoints = customer?.points ?? 0;
    if (availablePoints <= 0) {
      return { pointsDeductFen: 0, pointsUsed: 0 };
    }

    const maxDeductFen = Math.floor(
      new Decimal(priceAfterDiscountFen)
        .mul(pointsRatio.maxRedeemRatio)
        .toNumber(),
    );

    const pointsToFenRatio = 100 / pointsRatio.redeemRatioPoints;
    const availableDeductFen = availablePoints * pointsToFenRatio;

    const pointsDeductFen = Math.min(maxDeductFen, availableDeductFen);
    const pointsUsed = Math.ceil(pointsDeductFen / pointsToFenRatio);

    return { pointsDeductFen, pointsUsed };
  }

  private async getPointsRatioConfig(
    storeId: number,
  ): Promise<ClubPointsRedeemConfig> {
    const settings = await this.prisma.marketingMemberLevelSetting.findUnique({
      where: { storeId },
      select: { pointsRatio: true },
    });

    return resolvePointsRedeemConfig(settings?.pointsRatio);
  }

  private formatFenToYuanText(cents: number): string {
    return Money.fromDbCents(cents).toFixedOutputYuan().replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  private static formatDiscountRateLabel(rate: number): string {
    const zhe = +(rate * 10).toFixed(1);
    return Number.isInteger(zhe) ? `${zhe}折` : `${zhe}折`;
  }

  private buildBreakdownItems(params: {
    memberBaselineFen: number;
    discountAmountFen: number;
    promotionDiscountAmountFen: number;
    promotionType: string | null;
    promotionTag: string | null;
    totalReduceFen: number;
    finalPriceFen: number;
    pointsDeductFen: number;
    memberDiscountRate: number | null;
  }): ClubOrderBreakdownItemDto[] {
    const items: ClubOrderBreakdownItemDto[] = [];

    // 会员售价行
    items.push({
      id: 'member-price',
      label: '会员售价',
      value: `¥${this.formatFenToYuanText(params.memberBaselineFen)}`,
      isDeduction: false,
      isStrikethrough: false,
    });

    // 等级折扣行（如有等级折扣且未被活动覆盖）
    const levelDiscountFen = params.discountAmountFen - params.promotionDiscountAmountFen - params.totalReduceFen;
    const hasPromotionOverride = params.promotionType !== null && params.promotionDiscountAmountFen > 0;
    if (levelDiscountFen > 0) {
      const discountRateLabel = params.memberDiscountRate != null
        ? ` ${ClubOrderPreviewService.formatDiscountRateLabel(params.memberDiscountRate)}`
        : '';
      items.push({
        id: 'level-discount',
        label: `折扣${discountRateLabel}`,
        value: `-¥${this.formatFenToYuanText(levelDiscountFen)}`,
        isDeduction: !hasPromotionOverride,
        isStrikethrough: hasPromotionOverride,
      });
    }

    // 活动折扣行（如有命中的活动）
    if (params.promotionType !== null && params.promotionDiscountAmountFen > 0) {
      items.push({
        id: `promotion-${params.promotionType}`,
        label: params.promotionTag ?? '活动折扣',
        value: `-¥${this.formatFenToYuanText(params.promotionDiscountAmountFen)}`,
        isDeduction: true,
        isStrikethrough: false,
      });
    }

    // 满减行（如有满减）
    if (params.totalReduceFen > 0) {
      items.push({
        id: 'reduce',
        label: '满减优惠',
        value: `-¥${this.formatFenToYuanText(params.totalReduceFen)}`,
        isDeduction: true,
        isStrikethrough: false,
      });
    }

    // 优惠后小计
    items.push({
      id: 'price-before-points',
      label: '优惠后小计',
      value: `¥${this.formatFenToYuanText(params.finalPriceFen)}`,
      isDeduction: false,
      isStrikethrough: false,
    });

    // 积分抵扣行（如有积分抵扣）
    if (params.pointsDeductFen > 0) {
      items.push({
        id: 'points-deduction',
        label: '积分抵扣',
        value: `-¥${this.formatFenToYuanText(params.pointsDeductFen)}`,
        isDeduction: true,
        isStrikethrough: false,
      });
    }

    return items;
  }
}
