import { Money } from '../../shared/money.utils';
import type {
  MarketingPromotionParamsValue,
  MarketingPromotionParamValue,
} from './marketing.utils';
import { safeParsePromotionParams } from './schemas/promotion-params.schema';

// ─── 活动参数归一化 ─────────────────────────────────────────────

function normalizePromotionParamValue(
  value: unknown,
): MarketingPromotionParamValue | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => normalizePromotionParamValue(item))
      .filter(
        (item): item is MarketingPromotionParamValue => item !== undefined,
      );
    return normalizedItems;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const normalizedEntries = Object.entries(value)
    .map(([key, entryValue]) => {
      const normalizedValue = normalizePromotionParamValue(entryValue);
      return normalizedValue === undefined ? null : [key, normalizedValue];
    })
    .filter(
      (entry): entry is [string, MarketingPromotionParamValue] =>
        entry !== null,
    );

  return Object.fromEntries(normalizedEntries);
}

function normalizeRechargeGiftParams(
  value: MarketingPromotionParamsValue,
): MarketingPromotionParamsValue {
  const gradientsSource =
    (Array.isArray(value.gradients) ? value.gradients : undefined) ??
    (Array.isArray(value.tiers) ? value.tiers : undefined);

  if (gradientsSource) {
    const gradients = gradientsSource
      .map((gradient) => normalizePromotionParamValue(gradient))
      .filter(
        (gradient): gradient is MarketingPromotionParamValue =>
          gradient !== undefined,
      );

    const rest = { ...value };
    delete rest.tiers;
    delete rest.gradients;

    return {
      ...rest,
      gradients,
    };
  }

  const rechargeAmount =
    typeof value.rechargeAmount === 'number'
      ? value.rechargeAmount
      : typeof value.threshold === 'number'
        ? value.threshold
        : undefined;

  const giftAmount =
    typeof value.giftAmount === 'number' ? value.giftAmount : undefined;
  const giftRatio =
    typeof value.giftRatio === 'number' ? value.giftRatio : undefined;

  if (
    typeof rechargeAmount === 'number' &&
    (typeof giftAmount === 'number' || typeof giftRatio === 'number')
  ) {
    return {
      gradients: [
        {
          rechargeAmount,
          ...(typeof giftAmount === 'number' ? { giftAmount } : {}),
          ...(typeof giftRatio === 'number' ? { giftRatio } : {}),
        },
      ],
    };
  }

  return value;
}

export function normalizePromotionParams(
  value: unknown,
  type?: string,
): MarketingPromotionParamsValue {
  // 1. 先用 Zod safeParse 做结构校验（宽松模式，校验失败不抛错）
  if (type) {
    const zodResult = safeParsePromotionParams(type, value);
    if (zodResult) {
      // Zod 校验通过，仍需走 recharge_gift 旧格式归一化
      if (type === 'recharge_gift') {
        return normalizeRechargeGiftParams(
          zodResult as MarketingPromotionParamsValue,
        );
      }
      return zodResult as MarketingPromotionParamsValue;
    }
  }

  // 2. Zod 校验失败或 type 未知，回退到手写归一化
  const normalizedValue = normalizePromotionParamValue(value);
  if (
    !normalizedValue ||
    Array.isArray(normalizedValue) ||
    typeof normalizedValue !== 'object'
  ) {
    return {};
  }

  const objectValue = normalizedValue as MarketingPromotionParamsValue;

  if (type === 'recharge_gift') {
    return normalizeRechargeGiftParams(objectValue);
  }

  return objectValue;
}

// ─── 活动参数写入/输出映射（元⇄分）─────────────────────────────────────

/** 金额字段名称集合（按活动类型）——写入时需要元→分 */
const YUAN_TO_CENTS_FIELDS = new Set([
  'threshold',
  'reduceAmount',
  'rechargeAmount',
  'giftAmount',
]);

/**
 * 写入映射：前端入参（元）→ DB 存储（分）
 * 只对已知金额字段做 * 100 转换，其余字段原样透传。
 */
function mapParamValueForWrite(value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(mapParamValueForWrite);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (YUAN_TO_CENTS_FIELDS.has(key) && typeof val === 'number') {
        result[key] = Money.fromInputYuan(val).toDbCents();
      } else {
        result[key] = mapParamValueForWrite(val);
      }
    }
    return result;
  }
  return value;
}

export function mapPromotionParamsForWrite(
  params: MarketingPromotionParamsValue,
  type: string,
): MarketingPromotionParamsValue {
  // discount / first_order_discount / points_recharge / free / points_2x 不涉及元→分
  if (
    type === 'discount' ||
    type === 'discount_day' ||
    type === 'first_order_discount' ||
    type === 'points_recharge' ||
    type === 'free' ||
    type === 'points_2x'
  ) {
    return params;
  }
  // reduce / recharge_gift 需要金额字段元→分
  return mapParamValueForWrite(params) as MarketingPromotionParamsValue;
}

/**
 * 输出映射：DB 存储（分）→ 前端输出（元）
 * 只对已知金额字段做 / 100 转换，其余字段原样透传。
 */
function mapParamValueForOutput(value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(mapParamValueForOutput);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (YUAN_TO_CENTS_FIELDS.has(key) && typeof val === 'number') {
        result[key] = Money.fromDbCents(val).toOutputYuan();
      } else {
        result[key] = mapParamValueForOutput(val);
      }
    }
    return result;
  }
  return value;
}

export function mapPromotionParamsForOutput(
  params: MarketingPromotionParamsValue,
  type: string,
): MarketingPromotionParamsValue {
  // discount / first_order_discount / points_recharge / free / points_2x 不涉及分→元
  if (
    type === 'discount' ||
    type === 'discount_day' ||
    type === 'first_order_discount' ||
    type === 'points_recharge' ||
    type === 'free' ||
    type === 'points_2x'
  ) {
    return params;
  }
  // reduce / recharge_gift 需要金额字段分→元
  return mapParamValueForOutput(params) as MarketingPromotionParamsValue;
}
