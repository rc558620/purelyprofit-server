import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type {
  ClubProductDto,
  ClubServiceProductTypeValue,
} from './dto/club-product.dto';
import type {
  ClubAppliedPromotion,
  ClubProductDiscountPromotion,
  ClubProductPricingContext,
  ClubProductRecord,
  ClubProductReducePromotion,
} from './club-products.types';

interface ClubProductPricingCandidate {
  amountFen: number;
  promotionId: string;
  promotionType: 'first_order_discount' | 'discount';
  discountRate: number;
  promotionTag: string;
}

interface ClubProductPricingResult {
  /** 会员售价（仅含等级折扣，不含活动优惠） */
  memberPriceFen: number;
  /** 最终价格（叠加所有优惠后） */
  finalPriceFen: number;
  /** 命中的折扣活动（等级/活动/首单三选一竞争胜出者） */
  bestDiscount: ClubProductPricingCandidate | null;
  /** 等级折扣是否被活动覆盖 */
  levelOverridden: boolean;
  /** 总满减减免金额（分） */
  totalReduceFen: number;
  /** 已应用的优惠活动列表 */
  appliedPromotions: ClubAppliedPromotion[];
}

@Injectable()
export class ClubProductViewService {
  toClubProduct(
    product: ClubProductRecord,
    hotProductIds: Set<number>,
    pricingContext: ClubProductPricingContext,
  ): ClubProductDto {
    const isHot = hotProductIds.has(product.id);
    const categoryTag = this.getCategoryName(product);
    const stock = this.getProductStock(product);
    const validityDesc = this.buildValidityDesc(product);
    const pricing = this.resolvePricing(product.price, pricingContext);
    const tags = Array.from(
      new Set([
        ...(isHot ? ['热销'] : []),
        ...(categoryTag ? [categoryTag] : []),
        ...(product.personCount && product.personCount > 1 ? ['多人适用'] : []),
      ]),
    );

    return {
      id: String(product.id),
      name: product.name,
      description: product.description?.trim() || '暂无服务说明',
      coverImage: product.image?.trim() || '',
      originalPrice: this.convertFenToYuan(
        product.originalPrice ?? product.price,
      ),
      memberPrice: this.convertFenToYuan(pricing.memberPriceFen),
      finalPrice: this.convertFenToYuan(pricing.finalPriceFen),
      memberDiscountRate: pricingContext.memberDiscountRate,
      levelOverridden: pricing.levelOverridden,
      ...(pricing.bestDiscount
        ? {
            promotionId: pricing.bestDiscount.promotionId,
            promotionType: pricing.bestDiscount.promotionType,
            discountRate: pricing.bestDiscount.discountRate,
            promotionTag: pricing.bestDiscount.promotionTag,
          }
        : {}),
      ...(pricing.totalReduceFen > 0
        ? { reduceAmount: this.convertFenToYuan(pricing.totalReduceFen) }
        : {}),
      ...(pricing.appliedPromotions.length > 0
        ? { appliedPromotions: pricing.appliedPromotions }
        : {}),
      type: this.resolveProductType(product),
      tags,
      isHot,
      ...(stock >= 0 ? { stock } : {}),
      ...(validityDesc ? { validityDesc } : {}),
      details: this.buildDetails(product, stock),
    };
  }

  private resolvePricing(
    amountFen: number,
    pricingContext: ClubProductPricingContext,
  ): ClubProductPricingResult {
    // 1. 会员基准价 = 原价 × 等级折扣率
    const baselineAmountFen = this.applyMemberDiscount(
      amountFen,
      pricingContext.memberDiscountRate,
    );
    const hasLevelDiscount =
      pricingContext.memberDiscountRate !== null &&
      pricingContext.memberDiscountRate < 1;

    // 2. 折扣竞争：等级折扣 / 活动折扣 / 首单折扣 三选一，取力度最大（最终价最低）
    //    活动折扣必须优于会员基准价才生效
    let bestDiscount: ClubProductPricingCandidate | null = null;

    // 2a. 活动折扣（discount 类型）
    pricingContext.discountPromotions.forEach((promotion) => {
      const candidate = this.buildDiscountCandidate(amountFen, promotion);
      if (
        candidate &&
        candidate.amountFen < baselineAmountFen &&
        this.isBetterCandidate(candidate, bestDiscount)
      ) {
        bestDiscount = candidate;
      }
    });

    // 2b. 首单优惠（first_order_discount 类型，同样基于原价竞争）
    pricingContext.firstOrderPromotions.forEach((promotion) => {
      const candidate = this.buildFirstOrderCandidate(amountFen, promotion);
      if (
        candidate &&
        candidate.amountFen < baselineAmountFen &&
        this.isBetterCandidate(candidate, bestDiscount)
      ) {
        bestDiscount = candidate;
      }
    });

    // 判断等级折扣是否被活动覆盖
    // 用 const 重新绑定，避免 TypeScript forEach 回调内突变窄化问题
    const chosenDiscount = bestDiscount as ClubProductPricingCandidate | null;

    const levelOverridden =
      hasLevelDiscount &&
      chosenDiscount !== null &&
      chosenDiscount.amountFen < baselineAmountFen;

    // 折扣后价格（无活动折扣时用会员基准价）
    const afterDiscountFen = chosenDiscount?.amountFen ?? baselineAmountFen;

    // 3. 满减叠加：所有满足门槛的满减活动均可叠加
    let totalReduceFen = 0;
    const reduceApplied: Array<{
      promotion: ClubProductReducePromotion;
      savingFen: number;
    }> = [];

    pricingContext.reducePromotions.forEach((promotion) => {
      if (amountFen >= promotion.thresholdFen) {
        totalReduceFen += promotion.reduceAmountFen;
        reduceApplied.push({
          promotion,
          savingFen: promotion.reduceAmountFen,
        });
      }
    });

    // 4. 最终价格 = 折扣后价 - 满减总额
    const finalPriceFen = Math.max(afterDiscountFen - totalReduceFen, 0);

    // 5. 构建已应用活动列表（包含会员等级折扣）
    const appliedPromotions: ClubAppliedPromotion[] = [];

    // 5a. 会员等级折扣（始终展示，被覆盖时划线）
    if (hasLevelDiscount) {
      const levelSavingFen = Math.max(amountFen - baselineAmountFen, 0);
      const discountRate10 = Math.round(
        (pricingContext.memberDiscountRate ?? 1) * 10,
      );
      const discountLabel =
        discountRate10 % 1 === 0
          ? `${discountRate10}折会员价`
          : `${((pricingContext.memberDiscountRate ?? 1) * 10).toFixed(1)}折会员价`;
      appliedPromotions.push({
        id: 'member_level',
        type: 'member_level',
        tag: discountLabel,
        discountRate: Math.round(
          (pricingContext.memberDiscountRate ?? 1) * 100,
        ),
        savingAmount: this.convertFenToYuan(levelSavingFen),
        overridden: levelOverridden,
      });
    }

    // 5b. 折扣活动（胜出的活动折扣 / 首单优惠）
    if (chosenDiscount) {
      appliedPromotions.push({
        id: chosenDiscount.promotionId,
        type: chosenDiscount.promotionType,
        tag: chosenDiscount.promotionTag,
        discountRate: chosenDiscount.discountRate,
        savingAmount: this.convertFenToYuan(
          Math.max(amountFen - chosenDiscount.amountFen, 0),
        ),
      });
    }

    // 5c. 满减活动
    reduceApplied.forEach(({ promotion, savingFen }) => {
      appliedPromotions.push({
        id: String(promotion.id),
        type: 'reduce',
        tag: promotion.tag,
        savingAmount: this.convertFenToYuan(savingFen),
      });
    });

    return {
      memberPriceFen: baselineAmountFen,
      finalPriceFen,
      bestDiscount: chosenDiscount,
      levelOverridden,
      totalReduceFen,
      appliedPromotions,
    };
  }

  private isBetterCandidate(
    candidate: ClubProductPricingCandidate,
    currentBest: ClubProductPricingCandidate | null,
  ): boolean {
    if (!currentBest) {
      return true;
    }

    return candidate.amountFen < currentBest.amountFen;
  }

  private buildDiscountCandidate(
    originalAmountFen: number,
    promotion: ClubProductDiscountPromotion,
  ): ClubProductPricingCandidate | null {
    const amountFen = this.applyPercentDiscount(
      originalAmountFen,
      promotion.discountRate,
    );
    // 必须比原价便宜才有效
    if (amountFen >= originalAmountFen) {
      return null;
    }

    return {
      amountFen,
      promotionId: String(promotion.id),
      promotionType: 'discount',
      discountRate: promotion.discountRate,
      promotionTag: promotion.tag,
    };
  }

  private buildFirstOrderCandidate(
    originalAmountFen: number,
    promotion: ClubProductDiscountPromotion,
  ): ClubProductPricingCandidate | null {
    const amountFen = this.applyPercentDiscount(
      originalAmountFen,
      promotion.discountRate,
    );
    if (amountFen >= originalAmountFen) {
      return null;
    }

    return {
      amountFen,
      promotionId: String(promotion.id),
      promotionType: 'first_order_discount',
      discountRate: promotion.discountRate,
      promotionTag: promotion.tag,
    };
  }

  private resolveProductType(
    product: ClubProductRecord,
  ): ClubServiceProductTypeValue {
    if (product.personCount && product.personCount > 1) {
      return 'package';
    }

    if (product.durationMinutes && product.durationMinutes >= 90) {
      return 'experience';
    }

    return 'product';
  }

  private buildValidityDesc(product: ClubProductRecord): string | undefined {
    const parts: string[] = [];
    if (product.durationMinutes) {
      parts.push(`单次服务约 ${product.durationMinutes} 分钟`);
    }
    if (product.personCount) {
      parts.push(`适用 ${product.personCount} 人`);
    }
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }

  private buildDetails(product: ClubProductRecord, stock: number): string[] {
    const categoryName = this.getCategoryName(product);
    const details = [
      product.description?.trim() || '',
      categoryName ? `服务分类：${categoryName}` : '',
      product.durationMinutes
        ? `参考时长：${product.durationMinutes} 分钟`
        : '',
      product.personCount ? `适用人数：${product.personCount} 人` : '',
      stock >= 0 ? `当前库存：${stock} 份` : '',
    ].filter((item) => item.length > 0);

    return details.length > 0 ? details : ['暂无服务详情'];
  }

  private getCategoryName(product: ClubProductRecord): string {
    return product.category?.name?.trim() ?? '';
  }

  private getProductStock(product: ClubProductRecord): number {
    return typeof product.stock === 'number' ? product.stock : -1;
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

  private convertFenToYuan(amountFen: number): number {
    return new Decimal(amountFen).div(100).toDecimalPlaces(2).toNumber();
  }
}
