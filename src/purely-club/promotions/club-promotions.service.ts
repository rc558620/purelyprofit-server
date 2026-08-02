import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Money } from '../../shared/money.utils';
import { formatShanghaiDayLabel } from '../../shared/shanghai-time.utils';
import { normalizePromotionParams } from '../../purely-profit/marketing/marketing.mapper';
import {
  MARKETING_PROMOTION_TYPE_VALUES,
  type MarketingPromotionParamValue,
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

/** 首页活动列表最大返回条数 */
const CLUB_HOME_PROMOTION_LIMIT = 20;

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
      // 数据库按创建时间倒序取候选集，内存中再按 sort/priority/startAt 精排
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CLUB_HOME_PROMOTION_LIMIT,
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
    const normalizedName = promotion.name?.trim() ?? '';
    const resolvedName =
      normalizedName || this.buildFallbackName(promotion.type);
    const normalizedDescription = promotion.description?.trim() ?? '';
    const rawParams = normalizePromotionParams(
      promotion.params,
      promotion.type,
    );
    const presentation = this.resolvePresentation(promotion.type);
    const bannerImage = this.resolveBannerImage(rawParams);

    // 从 params 副本中移除展示层已提取的 bannerImage 相关字段，避免与顶层重复
    const params = this.stripBannerFields(rawParams);
    // 将 params 中的金额字段从分转为元，前端不再需要做 /100
    const paramsInYuan = this.convertParamsFenToYuan(params, promotion.type);

    return {
      id: String(promotion.id),
      name: resolvedName,
      type: promotion.type,
      description: normalizedDescription,
      benefitText: normalizedDescription || resolvedName,
      ...this.resolveDiscountFoldText(rawParams, promotion.type),
      params: paramsInYuan,
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
          actionText: '了解详情',
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
    return formatShanghaiDayLabel(date.getTime()).replace('/', '.');
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

  /** 从 params 中移除已提取到顶层的 bannerImage 相关字段，返回裁剪后的副本 */
  private stripBannerFields(
    params: MarketingPromotionParamsValue,
  ): MarketingPromotionParamsValue {
    const cleaned = { ...params };
    delete cleaned.bannerImage;
    delete cleaned.image;
    delete cleaned.banner;
    return cleaned;
  }

  /**
   * 将活动 params 中的金额字段从分转为元。
   * 根据活动类型识别需要转换的字段，使用 Money.fromDbCents().toOutputYuan() 保证精度。
   */
  private convertParamsFenToYuan(
    params: MarketingPromotionParamsValue,
    type: MarketingPromotionTypeValue,
  ): MarketingPromotionParamsValue {
    const result = { ...params };

    switch (type) {
      case 'reduce':
        if (typeof result.threshold === 'number') {
          result.threshold = Money.fromDbCents(result.threshold).toOutputYuan();
        }
        if (typeof result.reduceAmount === 'number') {
          result.reduceAmount = Money.fromDbCents(
            result.reduceAmount,
          ).toOutputYuan();
        }
        break;

      case 'recharge_gift':
        if (Array.isArray(result.gradients)) {
          result.gradients = result.gradients.map(
            (gradient: MarketingPromotionParamsValue) => {
              if (
                !gradient ||
                typeof gradient !== 'object' ||
                Array.isArray(gradient)
              ) {
                return gradient;
              }
              const g = {
                ...(gradient as Record<string, MarketingPromotionParamValue>),
              };
              if (typeof g.rechargeAmount === 'number') {
                g.rechargeAmount = Money.fromDbCents(
                  g.rechargeAmount,
                ).toOutputYuan();
              }
              if (typeof g.giftAmount === 'number') {
                g.giftAmount = Money.fromDbCents(g.giftAmount).toOutputYuan();
              }
              return g;
            },
          );
        }
        break;

      case 'points_recharge':
        // points_recharge 的 rechargeAmount 可能也是分
        if (typeof result.rechargeAmount === 'number') {
          result.rechargeAmount = Money.fromDbCents(
            result.rechargeAmount,
          ).toOutputYuan();
        }
        break;

      default:
        // discount / first_order_discount / discount_day / free / points_2x
        // 这些类型的 params 中没有金额字段，不需要转换
        break;
    }

    return result;
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

  private resolveDiscountFoldText(
    params: MarketingPromotionParamsValue,
    type: MarketingPromotionTypeValue,
  ): { discountFoldText?: string } {
    const discountTypes: MarketingPromotionTypeValue[] = [
      'discount',
      'first_order_discount',
      'discount_day',
    ];
    if (!discountTypes.includes(type)) {
      return {};
    }

    const rawRate =
      typeof params.discountRate === 'number'
        ? params.discountRate
        : typeof params.rate === 'number'
          ? params.rate * 100
          : undefined;

    if (rawRate === undefined || rawRate <= 0 || rawRate > 100) {
      return {};
    }

    const foldValue = new Decimal(rawRate).div(10).toDecimalPlaces(1);
    const normalized = foldValue.isInteger()
      ? foldValue.toFixed(0)
      : foldValue.toFixed(1);

    return { discountFoldText: normalized };
  }
}
