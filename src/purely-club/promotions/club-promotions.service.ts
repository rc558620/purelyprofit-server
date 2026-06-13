import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { normalizePromotionParams } from '../../purely-profit/marketing/marketing.mapper';
import {
  MARKETING_PROMOTION_TYPE_VALUES,
  type MarketingPromotionParamsValue,
  type MarketingPromotionTypeValue,
} from '../../purely-profit/marketing/marketing.utils';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubPromotionActionTypeValue,
  ClubPromotionDto,
  ClubPromotionsResponseDto,
} from './dto/club-promotion.dto';
import {
  clubPromotionSelect,
  type ClubPromotionRecord,
} from './club-promotions.types';

interface ClubPromotionPresentation {
  priority: number;
  sort: number;
  actionText: string;
  actionType: ClubPromotionActionTypeValue;
  actionTarget: string;
}

@Injectable()
export class ClubPromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    currentContext: ClubCurrentContext,
  ): Promise<ClubPromotionsResponseDto> {
    const now = new Date();
    const promotions = await this.prisma.marketingPromotion.findMany({
      where: {
        storeId: currentContext.store.id,
        enabled: true,
        type: { in: [...MARKETING_PROMOTION_TYPE_VALUES] },
        startAt: { lte: now },
        endAt: { gte: now },
      },
      select: clubPromotionSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return {
      items: promotions
        .filter((promotion): promotion is ClubPromotionRecord =>
          this.isSupportedPromotionType(promotion.type),
        )
        .map((promotion) => this.toClubPromotion(promotion, now))
        .sort(
          (left, right) =>
            left.sort - right.sort ||
            right.priority - left.priority ||
            right.startAt - left.startAt,
        ),
    };
  }

  private isSupportedPromotionType(
    type: string,
  ): type is ClubPromotionRecord['type'] {
    return MARKETING_PROMOTION_TYPE_VALUES.includes(
      type as MarketingPromotionTypeValue,
    );
  }

  private toClubPromotion(
    promotion: ClubPromotionRecord,
    now: Date,
  ): ClubPromotionDto {
    const normalizedName = promotion.name.trim();
    const normalizedDescription = promotion.description.trim();
    const params = normalizePromotionParams(promotion.params, promotion.type);
    const presentation = this.resolvePresentation(promotion.type);
    const bannerImage = this.resolveBannerImage(params);

    return {
      id: String(promotion.id),
      name: normalizedName || this.buildFallbackName(promotion.type),
      type: promotion.type,
      description: normalizedDescription,
      benefitText: this.buildBenefitText(
        promotion.type,
        params,
        normalizedDescription,
        normalizedName,
      ),
      params,
      startAt: promotion.startAt.getTime(),
      endAt: promotion.endAt.getTime(),
      statusText: this.buildStatusText(promotion.endAt, now),
      timeRangeText: this.buildTimeRangeText(
        promotion.startAt,
        promotion.endAt,
      ),
      priority: presentation.priority,
      sort: presentation.sort,
      ...(bannerImage ? { bannerImage } : {}),
      actionText: presentation.actionText,
      actionType: presentation.actionType,
      actionTarget: presentation.actionTarget,
    };
  }

  private resolvePresentation(
    type: MarketingPromotionTypeValue,
  ): ClubPromotionPresentation {
    switch (type) {
      case 'first_order_discount':
        return {
          priority: 100,
          sort: 10,
          actionText: '去下单',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'recharge_gift':
        return {
          priority: 90,
          sort: 20,
          actionText: '去充值',
          actionType: 'open_recharge',
          actionTarget: 'club_recharge_packages',
        };
      case 'reduce':
        return {
          priority: 80,
          sort: 30,
          actionText: '去使用',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'discount':
        return {
          priority: 70,
          sort: 40,
          actionText: '去看看',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'free':
        return {
          priority: 60,
          sort: 50,
          actionText: '去体验',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'points_2x':
        return {
          priority: 50,
          sort: 60,
          actionText: '去消费',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'points_recharge':
        return {
          priority: 45,
          sort: 65,
          actionText: '去消费',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      case 'discount_day':
        return {
          priority: 85,
          sort: 15,
          actionText: '去看看',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
      default:
        return {
          priority: 40,
          sort: 70,
          actionText: '去看看',
          actionType: 'view_products',
          actionTarget: 'club_products',
        };
    }
  }

  private buildStatusText(endAt: Date, now: Date): string {
    const remainMs = endAt.getTime() - now.getTime();
    return remainMs <= 24 * 60 * 60 * 1000 ? '即将结束' : '进行中';
  }

  private buildTimeRangeText(startAt: Date, endAt: Date): string {
    return `${this.formatMonthDay(startAt)}-${this.formatMonthDay(endAt)}`;
  }

  private formatMonthDay(date: Date): string {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${month}.${day}`;
  }

  private resolveBannerImage(
    params: MarketingPromotionParamsValue,
  ): string | undefined {
    const candidates = [
      params.bannerImage,
      params.image,
      this.readNestedString(params.banner, 'image'),
      this.readNestedString(params.banner, 'url'),
    ];

    return candidates
      .find(
        (candidate): candidate is string =>
          typeof candidate === 'string' && candidate.trim().length > 0,
      )
      ?.trim();
  }

  private readNestedString(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const nestedValue = (value as Record<string, unknown>)[key];
    return typeof nestedValue === 'string' ? nestedValue : undefined;
  }

  private buildBenefitText(
    type: MarketingPromotionTypeValue,
    params: MarketingPromotionParamsValue,
    description: string,
    name: string,
  ): string {
    if (description) {
      return description;
    }

    if (type === 'discount' || type === 'first_order_discount') {
      const discountText = this.toDiscountText(params.discountRate);
      if (discountText) {
        return type === 'first_order_discount'
          ? `首单 ${discountText}`
          : `${discountText} 优惠`;
      }
    }

    if (type === 'reduce') {
      const threshold = this.toNumber(params.threshold);
      const reduceAmount = this.toNumber(params.reduceAmount);
      if (threshold !== null && reduceAmount !== null) {
        return `满${this.formatFenToYuanText(threshold)}减${this.formatFenToYuanText(
          reduceAmount,
        )}`;
      }
    }

    if (type === 'recharge_gift') {
      const rechargeGiftText = this.buildRechargeGiftText(params);
      if (rechargeGiftText) {
        return rechargeGiftText;
      }
    }

    if (type === 'free') {
      return '到店免费体验';
    }

    if (type === 'points_2x') {
      return '消费积分双倍';
    }

    if (type === 'points_recharge') {
      const ratio =
        this.toNumber(params.rechargeRatioPercent) ??
        this.toNumber(params.pointsRatio);
      if (ratio !== null && ratio > 0) {
        return `充值赠积分 ${ratio}%`;
      }
      return '充值赠积分';
    }

    if (type === 'discount_day') {
      const discountText = this.toDiscountText(params.discountRate);
      if (discountText) {
        return `折扣日 ${discountText}`;
      }
      return '折扣日优惠';
    }

    return name || '限时优惠';
  }

  private buildRechargeGiftText(
    params: MarketingPromotionParamsValue,
  ): string | null {
    const gradients = Array.isArray(params.gradients) ? params.gradients : [];
    const bestGradient = gradients
      .map((gradient) =>
        gradient && typeof gradient === 'object' ? gradient : null,
      )
      .filter(
        (gradient): gradient is MarketingPromotionParamsValue =>
          gradient !== null,
      )
      .reduce<MarketingPromotionParamsValue | null>((best, current) => {
        const currentRechargeAmount = this.toNumber(
          current.rechargeAmount ?? current.threshold,
        );
        const bestRechargeAmount = best
          ? this.toNumber(best.rechargeAmount ?? best.threshold)
          : null;
        if (best === null) {
          return current;
        }
        if (currentRechargeAmount === null) {
          return best;
        }
        if (
          bestRechargeAmount === null ||
          currentRechargeAmount > bestRechargeAmount
        ) {
          return current;
        }
        return best;
      }, null);

    const candidate = bestGradient ?? params;
    const rechargeAmount = this.toNumber(
      candidate.rechargeAmount ?? candidate.threshold,
    );
    if (rechargeAmount === null) {
      return null;
    }

    const giftAmount = this.toNumber(candidate.giftAmount);
    if (giftAmount !== null) {
      return `充${this.formatFenToYuanText(rechargeAmount)}送${this.formatFenToYuanText(
        giftAmount,
      )}`;
    }

    const giftRatio = this.toNumber(candidate.giftRatio);
    if (giftRatio !== null) {
      return `充值享 ${(giftRatio * 100).toFixed(0)}% 赠送`;
    }

    return null;
  }

  private buildFallbackName(type: MarketingPromotionTypeValue): string {
    switch (type) {
      case 'discount':
        return '折扣优惠';
      case 'reduce':
        return '满减优惠';
      case 'recharge_gift':
        return '充值赠送';
      case 'first_order_discount':
        return '首单优惠';
      case 'free':
        return '免费体验';
      case 'points_2x':
        return '双倍积分';
      case 'points_recharge':
        return '积分抵现';
      case 'discount_day':
        return '折扣日';
      default:
        return '限时优惠';
    }
  }

  private toDiscountText(rawDiscountRate: unknown): string | null {
    const discountRate = this.toNumber(rawDiscountRate);
    if (discountRate === null || discountRate <= 0) {
      return null;
    }

    const normalizedDiscountRate =
      discountRate > 1 ? discountRate : discountRate * 100;
    if (normalizedDiscountRate >= 100) {
      return null;
    }

    return (
      new Decimal(normalizedDiscountRate)
        .div(10)
        .toDecimalPlaces(1)
        .toString()
        .replace(/\.0$/, '') + '折'
    );
  }

  private formatFenToYuanText(amountFen: number): string {
    return new Decimal(amountFen)
      .div(100)
      .toDecimalPlaces(2)
      .toString()
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  }

  private toNumber(value: unknown): number | null {
    if (
      typeof value !== 'number' ||
      Number.isNaN(value) ||
      !Number.isFinite(value)
    ) {
      return null;
    }

    return value;
  }
}
