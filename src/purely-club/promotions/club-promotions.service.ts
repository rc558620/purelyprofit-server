import { Injectable } from '@nestjs/common';
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
      benefitText: normalizedDescription,
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
}
