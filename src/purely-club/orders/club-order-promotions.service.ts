import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ClubMemberLevelsService } from '../member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../member/member-profile/club-member-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  discountParamsSchema,
  firstOrderDiscountParamsSchema,
  reduceParamsSchema,
} from '../../purely-profit/marketing/schemas/promotion-params.schema';

export type ClubServicePromotionType =
  | 'first_order_discount'
  | 'discount'
  | 'discount_day'
  | 'reduce';

interface ClubPromotionRecord {
  id: number;
  name: string;
  type: ClubServicePromotionType;
  params: unknown;
}

interface ClubPricingCandidate {
  amountFen: number;
  promotionId: number | null;
  promotionType: ClubServicePromotionType | null;
  discountRate: number | null;
  promotionTag: string | null;
  promotionDiscountAmountFen: number;
}

export interface ClubServicePricingResolution {
  /** 最终应付金额（分） */
  amountFen: number;
  /** 会员基准价 = 原价 × 等级折扣率（分） */
  memberBaselineFen: number;
  /** 总优惠金额 = 原价 - 最终价（分） */
  discountAmountFen: number;
  /** 命中的折扣活动 ID（等级/活动/首单竞争胜出者） */
  promotionId: number | null;
  /** 命中的活动类型 */
  promotionType: ClubServicePromotionType | null;
  /** 命中的折扣率（0-100 整数） */
  discountRate: number | null;
  /** 活动标签 */
  promotionTag: string | null;
  /** 折扣活动单独贡献的优惠金额（分） */
  promotionDiscountAmountFen: number;
  /** 总满减减免金额（分） */
  totalReduceFen: number;
}

@Injectable()
export class ClubOrderPromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
  ) {}

  async resolvePricing(
    storeId: number,
    customerId: number,
    phone: string,
    amountFen: number,
  ): Promise<ClubServicePricingResolution> {
    const [memberDiscountRate, promotions, consumptionCount] =
      await Promise.all([
        this.resolveMemberDiscountRate(storeId, phone),
        this.loadActivePromotions(storeId),
        this.prisma.marketingConsumption.count({
          where: {
            storeId,
            customerId,
          },
        }),
      ]);

    // 1. 会员基准价 = 原价 × 等级折扣率
    const baselineAmountFen = this.applyMemberDiscount(
      amountFen,
      memberDiscountRate,
    );

    // 2. 折扣竞争：discount / first_order_discount 与等级折扣三选一
    //    活动折扣必须比会员基准价更优才生效
    let bestDiscount: ClubPricingCandidate | null = null;

    for (const promotion of promotions) {
      const candidate = this.toDiscountCandidate(
        promotion,
        amountFen,
        consumptionCount,
      );
      if (
        candidate &&
        candidate.amountFen < baselineAmountFen &&
        (!bestDiscount || candidate.amountFen < bestDiscount.amountFen)
      ) {
        bestDiscount = candidate;
      }
    }

    const chosenDiscount = bestDiscount as ClubPricingCandidate | null;
    const afterDiscountFen = chosenDiscount?.amountFen ?? baselineAmountFen;

    // 3. 满减叠加：所有满足门槛的满减活动均可叠加
    //    满减门槛基于原价（amountFen）判断，与产品列表展示逻辑一致
    let totalReduceFen = 0;
    for (const promotion of promotions) {
      if (promotion.type !== 'reduce') continue;
      const reduceConfig = this.resolveReduceConfig(promotion.params);
      if (!reduceConfig || amountFen < reduceConfig.thresholdFen) continue;
      totalReduceFen += reduceConfig.reduceAmountFen;
    }

    // 4. 最终价 = 折扣后价 - 满减总额
    const finalAmountFen = Math.max(afterDiscountFen - totalReduceFen, 0);

    return {
      amountFen: finalAmountFen,
      memberBaselineFen: baselineAmountFen,
      discountAmountFen: Math.max(amountFen - finalAmountFen, 0),
      promotionId: chosenDiscount?.promotionId ?? null,
      promotionType: chosenDiscount?.promotionType ?? null,
      discountRate: chosenDiscount?.discountRate ?? null,
      promotionTag: chosenDiscount?.promotionTag ?? null,
      promotionDiscountAmountFen:
        chosenDiscount?.promotionDiscountAmountFen ?? 0,
      totalReduceFen,
    };
  }

  private async resolveMemberDiscountRate(
    storeId: number,
    phone: string,
  ): Promise<number | null> {
    const snapshot =
      await this.clubMemberProfileService.getSnapshotByStoreAndPhone(
        storeId,
        phone,
      );
    if (!snapshot) {
      return null;
    }

    const levelConfig =
      await this.clubMemberLevelsService.resolveCurrentLevelConfig(snapshot);
    return levelConfig.discountRate > 0 && levelConfig.discountRate < 1
      ? levelConfig.discountRate
      : null;
  }

  private loadActivePromotions(
    storeId: number,
  ): Promise<ClubPromotionRecord[]> {
    const now = new Date();
    return this.prisma.marketingPromotion.findMany({
      where: {
        storeId,
        enabled: true,
        type: {
          in: ['first_order_discount', 'discount', 'discount_day', 'reduce'],
        },
        startAt: { lte: now },
        endAt: { gte: now },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        type: true,
        params: true,
      },
    }) as Promise<ClubPromotionRecord[]>;
  }

  private toDiscountCandidate(
    promotion: ClubPromotionRecord,
    originalAmountFen: number,
    consumptionCount: number,
  ): ClubPricingCandidate | null {
    switch (promotion.type) {
      case 'discount':
        return this.buildDiscountCandidate(promotion, originalAmountFen);
      case 'discount_day':
        return this.buildDiscountDayCandidate(promotion, originalAmountFen);
      case 'first_order_discount':
        return consumptionCount > 0
          ? null
          : this.buildFirstOrderCandidate(promotion, originalAmountFen);
      default:
        return null;
    }
  }

  private buildDiscountCandidate(
    promotion: ClubPromotionRecord,
    originalAmountFen: number,
  ): ClubPricingCandidate | null {
    const discountRate = this.resolvePromotionDiscountRate(promotion.params);
    if (discountRate === null) {
      return null;
    }

    const amountFen = this.applyPercentDiscount(
      originalAmountFen,
      discountRate,
    );
    if (amountFen >= originalAmountFen) {
      return null;
    }

    return {
      amountFen,
      promotionId: promotion.id,
      promotionType: 'discount',
      discountRate,
      promotionTag: this.buildDiscountTag(discountRate, promotion.name),
      promotionDiscountAmountFen: Math.max(originalAmountFen - amountFen, 0),
    };
  }

  /** 折扣日活动：与 discount 逻辑一致，params 中同样使用 discountRate */
  private buildDiscountDayCandidate(
    promotion: ClubPromotionRecord,
    originalAmountFen: number,
  ): ClubPricingCandidate | null {
    const discountRate = this.resolvePromotionDiscountRate(promotion.params);
    if (discountRate === null) {
      return null;
    }

    const amountFen = this.applyPercentDiscount(
      originalAmountFen,
      discountRate,
    );
    if (amountFen >= originalAmountFen) {
      return null;
    }

    return {
      amountFen,
      promotionId: promotion.id,
      promotionType: 'discount_day',
      discountRate,
      promotionTag: this.buildDiscountDayTag(discountRate, promotion.name),
      promotionDiscountAmountFen: Math.max(originalAmountFen - amountFen, 0),
    };
  }

  private buildFirstOrderCandidate(
    promotion: ClubPromotionRecord,
    originalAmountFen: number,
  ): ClubPricingCandidate | null {
    const discountRate = this.resolvePromotionDiscountRate(promotion.params);
    if (discountRate === null) {
      return null;
    }

    const amountFen = this.applyPercentDiscount(
      originalAmountFen,
      discountRate,
    );
    const promotionDiscountAmountFen = Math.max(
      originalAmountFen - amountFen,
      0,
    );
    if (promotionDiscountAmountFen <= 0) {
      return null;
    }

    return {
      amountFen,
      promotionId: promotion.id,
      promotionType: 'first_order_discount',
      discountRate,
      promotionTag: this.buildFirstOrderTag(discountRate, promotion.name),
      promotionDiscountAmountFen,
    };
  }

  private resolvePromotionDiscountRate(params: unknown): number | null {
    // 优先使用 Zod schema 校验
    const zodResult =
      discountParamsSchema.safeParse(params) ??
      firstOrderDiscountParamsSchema.safeParse(params);
    if (zodResult.success) {
      const data = zodResult.data;
      let discountRate: number | null = null;

      if (typeof data.discountRate === 'number') {
        discountRate = data.discountRate;
      } else if (typeof data.rate === 'number') {
        discountRate = data.rate * 100;
      }

      if (discountRate !== null) {
        return new Decimal(discountRate).toDecimalPlaces(1).toNumber();
      }
    }

    // Zod 校验失败，回退到手写解析
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return null;
    }

    const candidate = params as Record<string, unknown>;

    const rawDiscountRate = candidate.discountRate;
    const rawRate = candidate.rate;

    let discountRate: number | null = null;

    if (rawDiscountRate !== null && rawDiscountRate !== undefined) {
      const parsed = Number(rawDiscountRate);
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 100) {
        discountRate = parsed;
      }
    }

    if (discountRate === null && rawRate !== null && rawRate !== undefined) {
      const parsed = Number(rawRate);
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) {
        discountRate = parsed * 100;
      }
    }

    if (discountRate === null) {
      return null;
    }

    return new Decimal(discountRate).toDecimalPlaces(1).toNumber();
  }

  /**
   * 解析满减活动参数
   * 优先使用 Zod schema 校验，失败回退到手写解析
   */
  private resolveReduceConfig(
    params: unknown,
  ): { thresholdFen: number; reduceAmountFen: number } | null {
    const zodResult = reduceParamsSchema.safeParse(params);
    if (zodResult.success) {
      const data = zodResult.data;
      if (
        typeof data.threshold === 'number' &&
        typeof data.reduceAmount === 'number'
      ) {
        return {
          thresholdFen: Math.round(data.threshold),
          reduceAmountFen: Math.round(data.reduceAmount),
        };
      }
    }

    // Zod 校验失败，回退到手写解析
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return null;
    }

    const candidate = params as Record<string, unknown>;
    const thresholdFen = this.toPositiveInteger(candidate.threshold);
    const reduceAmountFen = this.toPositiveInteger(candidate.reduceAmount);
    if (!thresholdFen || !reduceAmountFen) {
      return null;
    }

    return {
      thresholdFen,
      reduceAmountFen,
    };
  }

  private toPositiveInteger(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const numValue = Number(value);
    if (!Number.isFinite(numValue) || numValue <= 0) {
      return null;
    }
    return Math.round(numValue);
  }

  private applyMemberDiscount(
    amountFen: number,
    memberDiscountRate: number | null,
  ): number {
    if (memberDiscountRate === null) {
      return amountFen;
    }

    return new Decimal(amountFen)
      .mul(memberDiscountRate)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
  }

  private applyPercentDiscount(
    amountFen: number,
    discountRate: number,
  ): number {
    return new Decimal(amountFen)
      .mul(discountRate)
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
  }

  private buildFirstOrderTag(
    discountRate: number,
    fallbackName: string,
  ): string {
    const normalizedName = fallbackName.trim();
    if (normalizedName) {
      return normalizedName;
    }

    return `首单 ${this.toDiscountText(discountRate)}`;
  }

  private buildDiscountTag(discountRate: number, fallbackName: string): string {
    const normalizedName = fallbackName.trim();
    if (normalizedName) {
      return normalizedName;
    }

    return `${this.toDiscountText(discountRate)} 优惠`;
  }

  private buildDiscountDayTag(
    discountRate: number,
    fallbackName: string,
  ): string {
    const normalizedName = fallbackName.trim();
    if (normalizedName) {
      return normalizedName;
    }

    return `折扣日 ${this.toDiscountText(discountRate)}`;
  }

  private buildReduceTag(
    thresholdFen: number,
    reduceAmountFen: number,
    fallbackName: string,
  ): string {
    const normalizedName = fallbackName.trim();
    if (normalizedName) {
      return normalizedName;
    }

    return `满${this.formatFenToYuanText(thresholdFen)}减${this.formatFenToYuanText(
      reduceAmountFen,
    )}`;
  }

  private toDiscountText(discountRate: number): string {
    return (
      new Decimal(discountRate)
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
}
