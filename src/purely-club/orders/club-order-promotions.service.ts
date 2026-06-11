import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';

export interface ClubEligibleFirstOrderPromotion {
  id: number;
  discountRate: number;
  tag: string;
  amountFen: number;
  discountAmountFen: number;
}

@Injectable()
export class ClubOrderPromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveEligibleFirstOrderPromotion(
    storeId: number,
    customerId: number,
    amountFen: number,
  ): Promise<ClubEligibleFirstOrderPromotion | null> {
    const now = new Date();
    const [consumptionCount, promotion] = await Promise.all([
      this.prisma.marketingConsumption.count({
        where: {
          storeId,
          customerId,
        },
      }),
      this.prisma.marketingPromotion.findFirst({
        where: {
          storeId,
          enabled: true,
          type: 'first_order_discount',
          startAt: { lte: now },
          endAt: { gte: now },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          params: true,
        },
      }),
    ]);

    if (consumptionCount > 0 || !promotion) {
      return null;
    }

    const discountRate = this.resolveDiscountRate(promotion.params);
    if (discountRate === null) {
      return null;
    }

    const discountedAmountFen = this.applyDiscountRate(amountFen, discountRate);
    const discountAmountFen = Math.max(amountFen - discountedAmountFen, 0);
    if (discountAmountFen <= 0) {
      return null;
    }

    return {
      id: promotion.id,
      discountRate,
      tag: this.buildPromotionTag(discountRate, promotion.name),
      amountFen: discountedAmountFen,
      discountAmountFen,
    };
  }

  private resolveDiscountRate(params: unknown): number | null {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return null;
    }

    const rawDiscountRate = (params as Record<string, unknown>).discountRate;
    if (!Number.isInteger(rawDiscountRate)) {
      return null;
    }

    const discountRate = Number(rawDiscountRate);
    if (discountRate <= 0 || discountRate >= 100) {
      return null;
    }

    return discountRate;
  }

  private buildPromotionTag(discountRate: number, fallbackName: string): string {
    const normalizedName = fallbackName.trim();
    if (normalizedName) {
      return normalizedName;
    }

    const discountText = new Decimal(discountRate)
      .div(10)
      .toDecimalPlaces(1)
      .toString()
      .replace(/\.0$/, '');
    return `首单 ${discountText} 折`;
  }

  private applyDiscountRate(amountFen: number, discountRate: number): number {
    return new Decimal(amountFen)
      .mul(discountRate)
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
  }
}
