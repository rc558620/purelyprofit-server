import Decimal from 'decimal.js';
import { parseDiscountRate } from '../club-discount.utils';
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

export interface ClubPromotionRecord {
  id: number;
  name: string;
  type: ClubServicePromotionType;
  params: unknown;
}

export interface ClubPricingCandidate {
  amountFen: number;
  promotionId: number | null;
  promotionType: ClubServicePromotionType | null;
  discountRate: number | null;
  promotionTag: string | null;
  promotionDiscountAmountFen: number;
}

/* ─── 折扣率解析 ─── */

export function resolvePromotionDiscountRate(params: unknown): number | null {
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

/* ─── 满减参数解析 ─── */

/**
 * 解析满减活动参数
 * 优先使用 Zod schema 校验，失败回退到手写解析
 */
export function resolveReduceConfig(
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
  const thresholdFen = toPositiveInteger(candidate.threshold);
  const reduceAmountFen = toPositiveInteger(candidate.reduceAmount);
  if (!thresholdFen || !reduceAmountFen) {
    return null;
  }

  return {
    thresholdFen,
    reduceAmountFen,
  };
}

/* ─── 折扣候选构建 ─── */

export function toDiscountCandidate(
  promotion: ClubPromotionRecord,
  baseAmountFen: number,
  consumptionCount: number,
): ClubPricingCandidate | null {
  switch (promotion.type) {
    case 'discount':
      return buildDiscountCandidate(promotion, baseAmountFen);
    case 'discount_day':
      return buildDiscountDayCandidate(promotion, baseAmountFen);
    case 'first_order_discount':
      return consumptionCount > 0
        ? null
        : buildFirstOrderCandidate(promotion, baseAmountFen);
    default:
      return null;
  }
}

function buildDiscountCandidate(
  promotion: ClubPromotionRecord,
  baseAmountFen: number,
): ClubPricingCandidate | null {
  const discountRate = resolvePromotionDiscountRate(promotion.params);
  if (discountRate === null) {
    return null;
  }

  const amountFen = applyPercentDiscount(baseAmountFen, discountRate);
  if (amountFen >= baseAmountFen) {
    return null;
  }

  return {
    amountFen,
    promotionId: promotion.id,
    promotionType: 'discount',
    discountRate,
    promotionTag: buildDiscountTag(discountRate, promotion.name),
    promotionDiscountAmountFen: Math.max(baseAmountFen - amountFen, 0),
  };
}

/** 折扣日活动：与 discount 逻辑一致，params 中同样使用 discountRate */
function buildDiscountDayCandidate(
  promotion: ClubPromotionRecord,
  baseAmountFen: number,
): ClubPricingCandidate | null {
  const discountRate = resolvePromotionDiscountRate(promotion.params);
  if (discountRate === null) {
    return null;
  }

  const amountFen = applyPercentDiscount(baseAmountFen, discountRate);
  if (amountFen >= baseAmountFen) {
    return null;
  }

  return {
    amountFen,
    promotionId: promotion.id,
    promotionType: 'discount_day',
    discountRate,
    promotionTag: buildDiscountDayTag(discountRate, promotion.name),
    promotionDiscountAmountFen: Math.max(baseAmountFen - amountFen, 0),
  };
}

function buildFirstOrderCandidate(
  promotion: ClubPromotionRecord,
  baseAmountFen: number,
): ClubPricingCandidate | null {
  const discountRate = resolvePromotionDiscountRate(promotion.params);
  if (discountRate === null) {
    return null;
  }

  const amountFen = applyPercentDiscount(baseAmountFen, discountRate);
  const promotionDiscountAmountFen = Math.max(baseAmountFen - amountFen, 0);
  if (promotionDiscountAmountFen <= 0) {
    return null;
  }

  return {
    amountFen,
    promotionId: promotion.id,
    promotionType: 'first_order_discount',
    discountRate,
    promotionTag: buildFirstOrderTag(discountRate, promotion.name),
    promotionDiscountAmountFen,
  };
}

/* ─── 数学计算 ─── */

export function applyPercentDiscount(
  amountFen: number,
  discountRate: number,
): number {
  return new Decimal(amountFen)
    .mul(discountRate)
    .div(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/* ─── 标签构建 ─── */

export function buildFirstOrderTag(
  discountRate: number,
  fallbackName: string,
): string {
  const normalizedName = fallbackName.trim();
  if (normalizedName) {
    return normalizedName;
  }

  return `首单 ${toDiscountText(discountRate)}`;
}

export function buildDiscountTag(
  discountRate: number,
  fallbackName: string,
): string {
  const normalizedName = fallbackName.trim();
  if (normalizedName) {
    return normalizedName;
  }

  return `${toDiscountText(discountRate)} 优惠`;
}

export function buildDiscountDayTag(
  discountRate: number,
  fallbackName: string,
): string {
  const normalizedName = fallbackName.trim();
  if (normalizedName) {
    return normalizedName;
  }

  return `折扣日 ${toDiscountText(discountRate)}`;
}

export function buildReduceTag(
  thresholdFen: number,
  reduceAmountFen: number,
  fallbackName: string,
): string {
  const normalizedName = fallbackName.trim();
  if (normalizedName) {
    return normalizedName;
  }

  return `满${formatFenToYuanText(thresholdFen)}减${formatFenToYuanText(
    reduceAmountFen,
  )}`;
}

/* ─── 格式化工具 ─── */

export function toDiscountText(discountRate: number): string {
  return (
    new Decimal(discountRate)
      .div(10)
      .toDecimalPlaces(1)
      .toString()
      .replace(/\.0$/, '') + '折'
  );
}

export function formatFenToYuanText(amountFen: number): string {
  return new Decimal(amountFen)
    .div(100)
    .toDecimalPlaces(2)
    .toString()
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

/* ─── 通用辅助 ─── */

export function toPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numValue = Number(value);
  if (!Number.isFinite(numValue) || numValue <= 0) {
    return null;
  }
  return Math.round(numValue);
}
