import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { parseDiscountRate } from '../club-discount.utils';
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
  /** 最终应付金额（分）= 活动折后价 - 满减 */
  amountFen: number;
  /**
   * 会员基准价 = 商品原价 × 会员等级折扣率（分）
   *
   * 这是整个折扣体系的起点：
   * - 会员折扣基于商品原价计算，得到会员基准价
   * - 活动折扣再基于会员基准价计算，得到活动折后价
   * - 两者叠加生效，不是二选一
   */
  memberBaselineFen: number;
  /** 总优惠金额 = 商品原价 - 最终价（分），含会员折扣 + 活动折扣 + 满减 */
  discountAmountFen: number;
  /** 命中的活动 ID（多个活动中优惠力度最大的一个） */
  promotionId: number | null;
  /** 命中的活动类型 */
  promotionType: ClubServicePromotionType | null;
  /**
   * 命中活动的折扣率（0-100 整数，如 79 表示 7.9折）
   *
   * 注意：此值为整数百分比，与 memberDiscountRate（0-1 小数）格式不同。
   * 传入 formatDiscountRateLabel 前必须先除以 100。
   */
  discountRate: number | null;
  /** 活动标签（如 "限时 7 折"） */
  promotionTag: string | null;
  /**
   * 活动折扣单独贡献的优惠金额（分）
   *
   * 计算公式：会员基准价 - 活动折后价
   * 例：会员价 ¥606.06，活动 7.9折，活动价 = 60606 × 0.79 = 47879，
   *     则 promotionDiscountAmountFen = 60606 - 47879 = 12727 (¥127.27)
   */
  promotionDiscountAmountFen: number;
  /** 总满减减免金额（分），skipReduce=true 时为 0 */
  totalReduceFen: number;
  /**
   * 满减前的应付金额（分）= 活动折后价（即 afterDiscountFen）
   *
   * 供调用方（如 preview）基于订单总额重新计算满减。
   * preview 会先乘以数量得到 beforeReduceTotalFen，
   * 再用 resolveOrderReduceFen 基于总额判断满减门槛。
   */
  amountFenBeforeReduce: number;
}

@Injectable()
export class ClubOrderPromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
  ) {}

  /**
   * 解析服务商品定价（会员折扣 + 活动折扣 + 满减）
   *
   * 计算流水线：
   *   原价 → [会员折扣] → 会员基准价 → [活动折扣] → 活动折后价 → [满减] → 最终价
   *
   * 折扣叠加模型（非竞争模型）：
   *   - 会员折扣基于商品原价计算
   *   - 活动折扣基于会员基准价计算（不是原价！）
   *   - 两者叠加生效，不做“取最优”竞争
   *   - 多个活动折扣中取 amountFen 最低的一个（优惠力度最大）
   *
   * @param amountFen 商品单价（分），即 context.product.price
   * @param options.skipReduce true 时跳过满减计算，由调用方基于订单总额重新计算
   */
  async resolvePricing(
    storeId: number,
    customerId: number,
    phone: string,
    amountFen: number,
    options?: { skipReduce?: boolean },
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

    // 2. 活动折扣叠加：在会员价基础上再应用活动折扣（取力度最大的活动）
    //    活动折扣基于会员基准价计算，与会员折扣叠加生效
    let bestDiscount: ClubPricingCandidate | null = null;

    for (const promotion of promotions) {
      const candidate = this.toDiscountCandidate(
        promotion,
        baselineAmountFen,
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
    //    skipReduce=true 时跳过，由调用方（如 preview）基于订单总额重新计算
    let totalReduceFen = 0;
    if (!options?.skipReduce) {
      for (const promotion of promotions) {
        if (promotion.type !== 'reduce') continue;
        const reduceConfig = this.resolveReduceConfig(promotion.params);
        if (!reduceConfig || amountFen < reduceConfig.thresholdFen) continue;
        totalReduceFen += reduceConfig.reduceAmountFen;
      }
    }

    // 4. 最终价 = 折扣后价 - 满减总额
    //    skipReduce 时 amountFenBeforeReduce 保留折扣后价，供调用方做订单级满减
    const finalAmountFen = Math.max(afterDiscountFen - totalReduceFen, 0);
    const amountFenBeforeReduce = afterDiscountFen;

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
      amountFenBeforeReduce,
    };
  }

  /**
   * 基于订单总金额计算满减优惠（单次生效，不叠加）
   *
   * 满减规则：
   *   - 门槛基于订单总额（折扣后单价 × 数量）判断，而非单价
   *   - 每个满减活动最多生效一次，不随购买数量叠加
   *   - 示例：满 50 减 9，订单总额 ¥200 也只减 ¥9，不是 ¥9 × 4 = ¥36
   *
   * @param orderTotalFen 订单总额（分）= 折扣后单价 × 数量
   */
  async resolveOrderReduceFen(
    storeId: number,
    orderTotalFen: number,
  ): Promise<number> {
    const promotions = await this.loadActivePromotions(storeId);
    let totalReduceFen = 0;
    for (const promotion of promotions) {
      if (promotion.type !== 'reduce') continue;
      const reduceConfig = this.resolveReduceConfig(promotion.params);
      if (!reduceConfig || orderTotalFen < reduceConfig.thresholdFen) continue;
      totalReduceFen += reduceConfig.reduceAmountFen;
    }
    return totalReduceFen;
  }

  async resolveMemberDiscountRate(
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
    baseAmountFen: number,
    consumptionCount: number,
  ): ClubPricingCandidate | null {
    switch (promotion.type) {
      case 'discount':
        return this.buildDiscountCandidate(promotion, baseAmountFen);
      case 'discount_day':
        return this.buildDiscountDayCandidate(promotion, baseAmountFen);
      case 'first_order_discount':
        return consumptionCount > 0
          ? null
          : this.buildFirstOrderCandidate(promotion, baseAmountFen);
      default:
        return null;
    }
  }

  private buildDiscountCandidate(
    promotion: ClubPromotionRecord,
    baseAmountFen: number,
  ): ClubPricingCandidate | null {
    const discountRate = this.resolvePromotionDiscountRate(promotion.params);
    if (discountRate === null) {
      return null;
    }

    const amountFen = this.applyPercentDiscount(baseAmountFen, discountRate);
    if (amountFen >= baseAmountFen) {
      return null;
    }

    return {
      amountFen,
      promotionId: promotion.id,
      promotionType: 'discount',
      discountRate,
      promotionTag: this.buildDiscountTag(discountRate, promotion.name),
      promotionDiscountAmountFen: Math.max(baseAmountFen - amountFen, 0),
    };
  }

  /** 折扣日活动：与 discount 逻辑一致，params 中同样使用 discountRate */
  private buildDiscountDayCandidate(
    promotion: ClubPromotionRecord,
    baseAmountFen: number,
  ): ClubPricingCandidate | null {
    const discountRate = this.resolvePromotionDiscountRate(promotion.params);
    if (discountRate === null) {
      return null;
    }

    const amountFen = this.applyPercentDiscount(baseAmountFen, discountRate);
    if (amountFen >= baseAmountFen) {
      return null;
    }

    return {
      amountFen,
      promotionId: promotion.id,
      promotionType: 'discount_day',
      discountRate,
      promotionTag: this.buildDiscountDayTag(discountRate, promotion.name),
      promotionDiscountAmountFen: Math.max(baseAmountFen - amountFen, 0),
    };
  }

  private buildFirstOrderCandidate(
    promotion: ClubPromotionRecord,
    baseAmountFen: number,
  ): ClubPricingCandidate | null {
    const discountRate = this.resolvePromotionDiscountRate(promotion.params);
    if (discountRate === null) {
      return null;
    }

    const amountFen = this.applyPercentDiscount(baseAmountFen, discountRate);
    const promotionDiscountAmountFen = Math.max(baseAmountFen - amountFen, 0);
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
    const discountRate = parseDiscountRate(candidate);

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
