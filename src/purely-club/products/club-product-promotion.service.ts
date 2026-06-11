import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubFirstOrderPromotion } from './club-products.types';

@Injectable()
export class ClubProductPromotionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveFirstOrderPromotion(
    storeId: number,
    phone: string,
  ): Promise<ClubFirstOrderPromotion | null> {
    const now = new Date();
    const [customer, promotion] = await Promise.all([
      this.prisma.marketingCustomer.findUnique({
        where: {
          storeId_phone: {
            storeId,
            phone,
          },
        },
        select: {
          id: true,
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

    if (!customer || !promotion) {
      return null;
    }

    const discountRate = this.resolveDiscountRate(promotion.params);
    if (discountRate === null) {
      return null;
    }

    const consumptionCount = await this.prisma.marketingConsumption.count({
      where: {
        storeId,
        customerId: customer.id,
      },
    });
    if (consumptionCount > 0) {
      return null;
    }

    return {
      id: promotion.id,
      discountRate,
      tag: this.buildPromotionTag(discountRate, promotion.name),
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

  private buildPromotionTag(
    discountRate: number,
    fallbackName: string,
  ): string {
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
}
