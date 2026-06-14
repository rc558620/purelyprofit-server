import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ClubMemberLevelsService } from '../member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../member/member-profile/club-member-profile.service';
import { PrismaService } from '../../prisma/prisma.service';

export type ClubServicePromotionType =
  | 'first_order_discount'
  | 'discount'
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
          in: ['first_order_discount', 'discount', 'reduce'],
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
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return null;
    }

    const candidate = params as Record<string, unknown>;

    // 兼容两种存储格式：
    // 1. discountRate: 80 —— 0-100 整数
    // 2. rate: 0.8 —— 0-1 小数
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

  private resolveReduceConfig(
    params: unknown,
  ): { thresholdFen: number; reduceAmountFen: number } | null {
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
