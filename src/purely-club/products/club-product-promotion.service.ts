import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ClubMemberLevelsService } from '../member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../member/member-profile/club-member-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ClubProductDiscountPromotion,
  ClubProductPricingContext,
  ClubProductReducePromotion,
} from './club-products.types';

interface ClubPromotionRecord {
  id: number;
  name: string;
  type: 'first_order_discount' | 'discount' | 'reduce';
  params: unknown;
}

@Injectable()
export class ClubProductPromotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
  ) {}

  async resolvePricingContext(
    storeId: number,
    phone: string,
  ): Promise<ClubProductPricingContext> {
    const customer = await this.prisma.marketingCustomer.findUnique({
      where: {
        storeId_phone: {
          storeId,
          phone,
        },
      },
      select: {
        id: true,
      },
    });

    const [memberDiscountRate, promotions, consumptionCount] =
      await Promise.all([
        this.resolveMemberDiscountRate(storeId, phone),
        this.loadActivePromotions(storeId),
        customer
          ? this.prisma.marketingConsumption.count({
              where: {
                storeId,
                customerId: customer.id,
              },
            })
          : Promise.resolve(0),
      ]);

    const firstOrderPromotions: ClubProductDiscountPromotion[] = [];
    const discountPromotions: ClubProductDiscountPromotion[] = [];
    const reducePromotions: ClubProductReducePromotion[] = [];

    promotions.forEach((promotion) => {
      if (promotion.type === 'first_order_discount') {
        if (consumptionCount > 0) {
          return;
        }
        const discountRate = this.resolvePromotionDiscountRate(
          promotion.params,
        );
        if (discountRate === null) {
          return;
        }
        firstOrderPromotions.push({
          id: promotion.id,
          discountRate,
          tag: this.buildFirstOrderTag(discountRate, promotion.name),
        });
        return;
      }

      if (promotion.type === 'discount') {
        const discountRate = this.resolvePromotionDiscountRate(
          promotion.params,
        );
        if (discountRate === null) {
          return;
        }
        discountPromotions.push({
          id: promotion.id,
          discountRate,
          tag: this.buildDiscountTag(discountRate, promotion.name),
        });
        return;
      }

      const reduceConfig = this.resolveReduceConfig(promotion.params);
      if (!reduceConfig) {
        return;
      }
      reducePromotions.push({
        id: promotion.id,
        thresholdFen: reduceConfig.thresholdFen,
        reduceAmountFen: reduceConfig.reduceAmountFen,
        tag: this.buildReduceTag(
          reduceConfig.thresholdFen,
          reduceConfig.reduceAmountFen,
          promotion.name,
        ),
      });
    });

    return {
      memberDiscountRate,
      firstOrderPromotions,
      discountPromotions,
      reducePromotions,
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

  private resolvePromotionDiscountRate(params: unknown): number | null {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return null;
    }

    const candidate = params as Record<string, unknown>;

    // 兼容两种存储格式：
    // 1. discountRate: 80 —— 0-100 整数，直接表示“打几折’的十倍值
    // 2. rate: 0.8 —— 0-1 小数，表示“付原价的百分比”
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
      // rate 在 0-1 范围（如 0.8 表示 8折），转换为 0-100 范围
      if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) {
        discountRate = parsed * 100;
      }
    }

    if (discountRate === null) {
      return null;
    }

    return Math.round(discountRate);
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
