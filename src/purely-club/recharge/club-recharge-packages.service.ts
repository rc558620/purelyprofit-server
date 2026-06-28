import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubRechargePackageDto } from './dto/club-recharge.dto';
import {
  type ClubRechargePromotionParams,
  type ClubRechargePromotionRecord,
  DEFAULT_CLUB_RECHARGE_PACKAGES,
} from './club-recharge.types';
import {
  Money,
  toNonNegativeInteger,
  toNonNegativeNumber,
  toPositiveInteger,
} from './club-recharge.utils';

@Injectable()
export class ClubRechargePackagesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 加载门店充值套餐列表
   * 优先从营销活动加载，无活动时返回默认套餐
   */
  async loadPackagesForStore(
    storeId: number,
  ): Promise<ClubRechargePackageDto[]> {
    const now = new Date();
    const promotions = await this.prisma.marketingPromotion.findMany({
      where: {
        storeId,
        enabled: true,
        type: 'recharge_gift',
        startAt: { lte: now },
        endAt: { gte: now },
      },
      select: {
        id: true,
        name: true,
        description: true,
        params: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const mappedPackages = promotions.flatMap((promotion) =>
      this.toRechargePackages(promotion),
    );

    return mappedPackages.length > 0
      ? this.markRecommendedPackage(mappedPackages)
      : this.cloneDefaultPackages();
  }

  /**
   * 将营销活动转换为充值套餐
   */
  private toRechargePackages(
    promotion: ClubRechargePromotionRecord,
  ): ClubRechargePackageDto[] {
    const paramsList = this.normalizePromotionParams(promotion.params);
    if (paramsList.length === 0) {
      return [];
    }

    const normalizedName = promotion.name.trim();
    const normalizedDescription = promotion.description.trim();
    const tag = normalizedDescription || normalizedName || undefined;

    return paramsList.map((params, index) => ({
      id: this.buildPackageId(promotion.id, index, paramsList.length),
      amount: Money.fromDbCents(params.rechargeAmountFen).toOutputYuan(),
      bonusAmount: Money.fromDbCents(params.giftAmountFen).toOutputYuan(),
      ...(tag ? { tag } : {}),
      recommended: false,
    }));
  }

  /**
   * 标准化营销活动参数
   */
  private normalizePromotionParams(
    raw: unknown,
  ): ClubRechargePromotionParams[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }

    const candidate = raw as Partial<Record<string, unknown>>;
    const gradients =
      (Array.isArray(candidate.gradients) ? candidate.gradients : undefined) ??
      (Array.isArray(candidate.tiers) ? candidate.tiers : undefined);

    if (gradients) {
      return gradients
        .filter(
          (item): item is Record<string, unknown> =>
            item !== null && typeof item === 'object' && !Array.isArray(item),
        )
        .map((item) => this.normalizePromotionGradient(item))
        .filter((item): item is ClubRechargePromotionParams => item !== null);
    }

    const legacyGradient = this.normalizePromotionGradient(candidate);
    return legacyGradient ? [legacyGradient] : [];
  }

  private normalizePromotionGradient(
    raw: unknown,
  ): ClubRechargePromotionParams | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const candidate = raw as Partial<Record<string, unknown>>;
    const rechargeAmountFen = toPositiveInteger(
      candidate.rechargeAmount ?? candidate.threshold,
    );
    if (!rechargeAmountFen) {
      return null;
    }

    const giftAmountFen = this.resolveGiftAmountFen(
      candidate,
      rechargeAmountFen,
    );
    if (giftAmountFen < 0) {
      return null;
    }

    return {
      rechargeAmountFen,
      giftAmountFen,
    };
  }

  /**
   * 解析赠送金额
   */
  private resolveGiftAmountFen(
    candidate: Partial<Record<string, unknown>>,
    rechargeAmountFen: number,
  ): number {
    const explicitGiftAmount = toNonNegativeInteger(candidate.giftAmount);
    if (explicitGiftAmount !== null) {
      return explicitGiftAmount;
    }

    const giftRatio = toNonNegativeNumber(candidate.giftRatio);
    if (giftRatio !== null) {
      return new Decimal(rechargeAmountFen)
        .mul(giftRatio)
        .toDecimalPlaces(0)
        .toNumber();
    }

    return 0;
  }

  private buildPackageId(
    promotionId: number,
    gradientIndex: number,
    gradientCount: number,
  ): string {
    if (gradientCount <= 1) {
      return String(promotionId);
    }

    return `${promotionId}:${gradientIndex}`;
  }

  /**
   * 标记推荐套餐（赠金最多，同赠金时金额最大）
   */
  private markRecommendedPackage(
    packages: ClubRechargePackageDto[],
  ): ClubRechargePackageDto[] {
    let bestId: string | null = null;
    let bestBonusAmount = -1;
    let bestAmount = -1;

    for (const currentPackage of packages) {
      if (
        currentPackage.bonusAmount > bestBonusAmount ||
        (currentPackage.bonusAmount === bestBonusAmount &&
          currentPackage.amount > bestAmount)
      ) {
        bestId = currentPackage.id;
        bestBonusAmount = currentPackage.bonusAmount;
        bestAmount = currentPackage.amount;
      }
    }

    return packages.map((item) => ({
      ...item,
      recommended: item.id === bestId,
    }));
  }

  /**
   * 克隆默认套餐
   */
  private cloneDefaultPackages(): ClubRechargePackageDto[] {
    return DEFAULT_CLUB_RECHARGE_PACKAGES.map((item) => ({ ...item }));
  }
}
