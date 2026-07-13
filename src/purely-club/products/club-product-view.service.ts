import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Money } from '../../shared/money.utils';
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

interface ClubProductBestDiscount {
  promotionId: string;
  promotionType: 'first_order_discount' | 'discount';
  discountRate: number;
  promotionTag: string;
  /** 活动折扣后的价格（分） */
  amountFen: number;
}

interface ClubProductPricingResult {
  /** 会员售价 = product.price（已是会员价） */
  memberPriceFen: number;
  /** 最终价格（竞争胜出价 - 满减） */
  finalPriceFen: number;
  /** 命中的活动折扣（竞争模型中的胜出活动） */
  bestDiscount: ClubProductBestDiscount | null;
  /** 活动折扣是否优于会员价 */
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
      categoryId: String(product.categoryId),
      categoryName: this.getCategoryName(product) || undefined,
      ...(product.descriptionTitle?.trim()
        ? { descriptionTitle: product.descriptionTitle.trim() }
        : {}),
      description: product.description?.trim() || '暂无服务说明',
      coverImage: product.image?.trim() || '',
      originalPrice: Money.fromDbCents(
        product.originalPrice ?? product.price,
      ).toOutputYuan(),
      // ── 价格展示基准规则（设计决策，勿修改）──
      // "会员价"使用 product.price 展示，product.price 本身就是会员价。
      memberPrice: Money.fromDbCents(product.price).toOutputYuan(),
      // ── finalPrice（设计决策，勿修改）──
      // 首页/列表页展示价 = 竞争胜出价 + 满减 后的最终价，
      // 来自 pricing.finalPriceFen（计算链完整，无需覆盖）。
      finalPrice: Money.fromDbCents(pricing.finalPriceFen).toOutputYuan(),
      ...(pricingContext.memberDiscountRate !== null
        ? { memberDiscountRate: pricingContext.memberDiscountRate }
        : {}),
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
        ? {
            reduceAmount: Money.fromDbCents(
              pricing.totalReduceFen,
            ).toOutputYuan(),
          }
        : {}),
      ...(pricing.appliedPromotions.length > 0
        ? { appliedPromotions: pricing.appliedPromotions }
        : {}),
      // 总节省金额：原价 - 最终价（不含积分抵扣），有节省时才返回
      ...(pricing.finalPriceFen < (product.originalPrice ?? product.price)
        ? {
            totalSavingAmount: Money.fromDbCents(
              (product.originalPrice ?? product.price) - pricing.finalPriceFen,
            ).toOutputYuan(),
          }
        : {}),
      type: this.resolveProductType(product),
      tags,
      isHot,
      isActive: product.isActive,
      stock,
      ...(product.durationMinutes
        ? { durationMinutes: product.durationMinutes }
        : {}),
      ...(product.personCount ? { personCount: product.personCount } : {}),
      ...(validityDesc ? { validityDesc } : {}),
      createdAt: product.createdAt.getTime(),
      updatedAt: product.updatedAt.getTime(),
    };
  }

  /**
   * 解析商品定价（竞争模型）
   *
   * 计算流水线：
   *   product.price（会员价） → [活动折扣竞争] → 胜出价 → [满减] → 最终价
   *
   * 竞争模型（与订单预计算/下单 ClubOrderPromotionsService 保持一致）：
   *   - product.price 本身就是会员价，不再施加会员等级折扣
   *   - 活动折扣直接基于 product.price 计算
   *   - 会员价与活动价取力度最大的一个（amountFen 最低者胜出）
   *   - 满减基于竞争胜出价判断门槛，满足则叠加
   */
  private resolvePricing(
    amountFen: number,
    pricingContext: ClubProductPricingContext,
  ): ClubProductPricingResult {
    // 1. 会员基准价 = product.price（已是会员价，不再施加会员等级折扣）
    //
    // ══════════════════════════════════════════════════════════════
    // ⚠️ 禁止对 amountFen 施加 memberDiscountRate！
    //
    // product.price 是 admin 设定的会员价，不是原价。
    // 如果再 × memberDiscountRate 会造成双重折扣。
    // 与 ClubOrderPromotionsService.resolvePricing 保持一致。
    // ══════════════════════════════════════════════════════════════
    const baselineAmountFen = amountFen;
    const hasLevelDiscount =
      pricingContext.memberDiscountRate !== null &&
      pricingContext.memberDiscountRate < 1;

    // 2. 活动折扣竞争：直接基于 product.price 计算，取力度最大的活动
    //    活动折扣与会员价竞争（取 amountFen 最低者），不做折上折
    let bestDiscount: ClubProductBestDiscount | null = null;

    // 2a. 活动折扣（discount 类型，基于 product.price 竞争）
    pricingContext.discountPromotions.forEach((promotion) => {
      const candidate = this.buildDiscountCandidate(
        baselineAmountFen,
        promotion,
      );
      if (
        candidate &&
        (!bestDiscount || candidate.amountFen < bestDiscount.amountFen)
      ) {
        bestDiscount = candidate;
      }
    });

    // 2b. 首单优惠（first_order_discount 类型，基于 product.price 竞争）
    //     防御性校验：仅当 isFirstOrderBuyer 为 true 时才允许参与
    if (pricingContext.isFirstOrderBuyer) {
      pricingContext.firstOrderPromotions.forEach((promotion) => {
        const candidate = this.buildFirstOrderCandidate(
          baselineAmountFen,
          promotion,
        );
        if (
          candidate &&
          (!bestDiscount || candidate.amountFen < bestDiscount.amountFen)
        ) {
          bestDiscount = candidate;
        }
      });
    }

    // 重新绑定类型，修复 TypeScript forEach 闭包突变窄化问题
    const chosenDiscount = bestDiscount as ClubProductBestDiscount | null;

    // 竞争模型：活动价低于会员价时，活动胜出
    const activityBelowMember = hasLevelDiscount
      ? chosenDiscount !== null && chosenDiscount.amountFen < baselineAmountFen
      : false;
    const levelOverridden = activityBelowMember;

    // 折扣后价格（竞争胜出者，无活动折扣时用会员价）
    const afterDiscountFen = chosenDiscount?.amountFen ?? baselineAmountFen;

    // 3. 满减叠加：所有满足门槛的满减活动均可叠加
    //    满减门槛基于折扣后价格（afterDiscountFen）判断
    let totalReduceFen = 0;
    const reduceApplied: Array<{
      promotion: ClubProductReducePromotion;
      savingFen: number;
    }> = [];

    pricingContext.reducePromotions.forEach((promotion) => {
      if (afterDiscountFen >= promotion.thresholdFen) {
        totalReduceFen += promotion.reduceAmountFen;
        reduceApplied.push({
          promotion,
          savingFen: promotion.reduceAmountFen,
        });
      }
    });

    // 4. 最终价格 = 折扣后价 - 满减总额
    const finalPriceFen = Math.max(afterDiscountFen - totalReduceFen, 0);

    // 5. 构建已应用活动列表
    const appliedPromotions: ClubAppliedPromotion[] = [];

    // 5a. 会员等级折扣（有实际节省时展示，被活动覆盖时划线）
    if (hasLevelDiscount) {
      appliedPromotions.push({
        id: 'member_level',
        type: 'member_level',
        tag: this.buildLevelDiscountTag(pricingContext.memberDiscountRate),
        discountRate: this.toRate100(pricingContext.memberDiscountRate),
        savingAmount: 0,
        overridden: levelOverridden,
      });
    }

    // 5b. 活动折扣（胜出活动 / 首单优惠，基于 product.price 的节省额）
    if (chosenDiscount) {
      appliedPromotions.push({
        id: chosenDiscount.promotionId,
        type: chosenDiscount.promotionType,
        tag: chosenDiscount.promotionTag,
        discountRate: chosenDiscount.discountRate,
        savingAmount: Money.fromDbCents(
          Math.max(baselineAmountFen - chosenDiscount.amountFen, 0),
        ).toOutputYuan(),
      });
    }

    // 5c. 满减活动
    reduceApplied.forEach(({ promotion, savingFen }) => {
      appliedPromotions.push({
        id: String(promotion.id),
        type: 'reduce',
        tag: promotion.tag,
        savingAmount: Money.fromDbCents(savingFen).toOutputYuan(),
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

  private buildDiscountCandidate(
    baseAmountFen: number,
    promotion: ClubProductDiscountPromotion,
  ): ClubProductBestDiscount | null {
    const amountFen = this.applyPercentDiscount(
      baseAmountFen,
      promotion.discountRate,
    );
    // 必须比基准价便宜才有效
    if (amountFen >= baseAmountFen) {
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
    baseAmountFen: number,
    promotion: ClubProductDiscountPromotion,
  ): ClubProductBestDiscount | null {
    const amountFen = this.applyPercentDiscount(
      baseAmountFen,
      promotion.discountRate,
    );
    if (amountFen >= baseAmountFen) {
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

  private getCategoryName(product: ClubProductRecord): string {
    return product.category?.name?.trim() ?? '';
  }

  private getProductStock(product: ClubProductRecord): number {
    return product.stock;
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

  /** 等级折扣率 → 0-100 整数或一位小数（如 0.81 → 81，0.8 → 80） */
  private toRate100(memberDiscountRate: number | null): number {
    return new Decimal(memberDiscountRate ?? 1)
      .mul(100)
      .toDecimalPlaces(0)
      .toNumber();
  }

  /** 等级折扣率 → "X折会员价" 标签（如 0.81 → "8.1折会员价"，0.8 → "8折会员价"） */
  private buildLevelDiscountTag(memberDiscountRate: number | null): string {
    const fold = new Decimal(memberDiscountRate ?? 1)
      .mul(10)
      .toDecimalPlaces(1);
    const foldText = fold.isInteger() ? fold.toFixed(0) : fold.toFixed(1);
    return `${foldText}折会员价`;
  }
}
