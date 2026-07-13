import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { parseDiscountRate } from '../club-discount.utils';
import { ClubMemberLevelsService } from '../member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../member/member-profile/club-member-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubPromotionRepository } from '../shared/club-promotion.repository';
import {
  discountParamsSchema,
  firstOrderDiscountParamsSchema,
  reduceParamsSchema,
} from '../../purely-profit/marketing/schemas/promotion-params.schema';
import type {
  ClubProductDiscountPromotion,
  ClubProductPricingContext,
  ClubProductReducePromotion,
} from './club-products.types';

@Injectable()
export class ClubProductPromotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
    private readonly clubPromotionRepository: ClubPromotionRepository,
  ) {}

  async resolvePricingContext(
    storeId: number,
    phone: string,
  ): Promise<ClubProductPricingContext> {
    const customer = await this.prisma.marketingCustomer.findFirst({
      where: {
        storeId,
        phone,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    const [memberDiscountRate, promotions, consumptionCount] =
      await Promise.all([
        this.resolveMemberDiscountRate(storeId, phone),
        this.clubPromotionRepository.loadActivePromotions(storeId),
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

      if (promotion.type === 'discount_day') {
        const discountRate = this.resolvePromotionDiscountRate(
          promotion.params,
        );
        if (discountRate === null) {
          return;
        }
        discountPromotions.push({
          id: promotion.id,
          discountRate,
          tag: this.buildDiscountDayTag(discountRate, promotion.name),
        });
        return;
      }

      if (promotion.type === 'reduce') {
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
      }
    });

    return {
      memberDiscountRate,
      isFirstOrderBuyer: consumptionCount === 0,
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

  private resolvePromotionDiscountRate(params: unknown): number | null {
    // BUG-10 修复：safeParse 总是返回 SafeParseResult，?? 不会起备选作用
    // 改为显式检查 success 做备选
    const discountResult = discountParamsSchema.safeParse(params);
    const zodResult = discountResult.success
      ? discountResult
      : firstOrderDiscountParamsSchema.safeParse(params);
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

    // Zod 校验失败，回退到手写解析（兼容旧数据）
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return null;
    }

    const candidate = params as Record<string, unknown>;
    const discountRate = parseDiscountRate(candidate);

    if (discountRate === null) {
      return null;
    }

    return new Decimal(discountRate).toDecimalPlaces(1).toNumber();
  }

  private resolveReduceConfig(
    params: unknown,
  ): { thresholdFen: number; reduceAmountFen: number } | null {
    // 优先使用 Zod schema 校验 reduce 的 params
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
