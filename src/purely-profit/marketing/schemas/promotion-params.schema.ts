// ─── MarketingPromotion.params 的 Zod Schema ────────────────────────
//
// 每个 MarketingPromotionType 对应一个独立的 Zod schema，
// 统一由 promotionParamsSchema 按 type 分发校验。
// 写入时用 .parse() 严格校验；读取时用 .safeParse() + 默认值兜底。

import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';

/** 金额上限（元）：防止 Money 整数溢出与明显异常配置；远低于安全整数上限 */
const MARKETING_PROMOTION_AMOUNT_YUAN_MAX = 1_000_000_000_000;

// ─── 通用 banner 字段（所有 type 都可能携带） ───────────────────────

const bannerFieldsSchema = z.object({
  bannerImage: z.string().optional(),
  image: z.string().optional(),
  banner: z
    .object({
      image: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
});

// ─── discount / discount_day ───────────────────────────────────────

/**
 * discountRate（0-100 整数）和 rate（0-1 小数）二选一；
 * 传入 rate 时自动转换为 discountRate，保证输出始终包含 discountRate。
 */
export const discountParamsSchema = z
  .object({
    /** 折扣率 0-100 整数，如 80 = 8折 */
    discountRate: z.number().int().min(1).max(99).optional(),
    /** 兼容旧格式：0-1 小数，如 0.8 = 8折 */
    rate: z.number().min(0.01).max(0.99).optional(),
  })
  .merge(bannerFieldsSchema)
  .passthrough()
  .refine(
    (data) => data.discountRate !== undefined || data.rate !== undefined,
    { message: 'discountRate 或 rate 至少提供一个', path: ['discountRate'] },
  )
  .transform((data) => {
    // 清理冗余 rate 字段，统一只保留 discountRate
    const { rate, ...rest } = data;
    if (data.discountRate === undefined && rate !== undefined) {
      return { ...rest, discountRate: Math.round(rate * 100) };
    }
    return rest;
  });

// ─── first_order_discount ─────────────────────────────────────────

export const firstOrderDiscountParamsSchema = z
  .object({
    /** 折扣率 0-100 整数 */
    discountRate: z.number().int().min(1).max(99).optional(),
    /** 兼容旧格式 */
    rate: z.number().min(0.01).max(0.99).optional(),
    /** 目标人群 */
    audience: z.string().optional(),
  })
  .merge(bannerFieldsSchema)
  .passthrough()
  .refine(
    (data) => data.discountRate !== undefined || data.rate !== undefined,
    { message: 'discountRate 或 rate 至少提供一个', path: ['discountRate'] },
  )
  .transform((data) => {
    // 清理冗余 rate 字段，统一只保留 discountRate
    const { rate, ...rest } = data;
    if (data.discountRate === undefined && rate !== undefined) {
      return { ...rest, discountRate: Math.round(rate * 100) };
    }
    return rest;
  });

// ─── reduce ────────────────────────────────────────────────────────

export const reduceParamsSchema = z
  .object({
    /** 满减门槛（前端入参=元，后端内部存储=分；mapper 层统一转换） */
    threshold: z.number().positive().max(MARKETING_PROMOTION_AMOUNT_YUAN_MAX),
    /** 满减金额（前端入参=元，后端内部存储=分；mapper 层统一转换） */
    reduceAmount: z
      .number()
      .positive()
      .max(MARKETING_PROMOTION_AMOUNT_YUAN_MAX),
  })
  .merge(bannerFieldsSchema)
  .passthrough()
  .refine((data) => data.reduceAmount < data.threshold, {
    message: '优惠金额必须小于满减门槛（reduceAmount < threshold）',
    path: ['reduceAmount'],
  });

// ─── recharge_gift ────────────────────────────────────────────────

const rechargeGiftGradientSchema = z.object({
  /** 充值金额（前端入参=元，后端内部存储=分；mapper 层统一转换） */
  rechargeAmount: z
    .number()
    .positive()
    .max(MARKETING_PROMOTION_AMOUNT_YUAN_MAX),
  /** 赠送金额（前端入参=元，后端内部存储=分；mapper 层统一转换） */
  giftAmount: z
    .number()
    .nonnegative()
    .max(MARKETING_PROMOTION_AMOUNT_YUAN_MAX)
    .optional(),
  /** 赠送比例（0-1） */
  giftRatio: z.number().min(0).max(1).optional(),
});

export const rechargeGiftParamsSchema = z
  .object({
    /** 多档梯度 */
    gradients: z.array(rechargeGiftGradientSchema).min(1).optional(),
    /** 兼容旧字段名 tiers */
    tiers: z.array(rechargeGiftGradientSchema).optional(),
  })
  .merge(bannerFieldsSchema)
  .passthrough()
  .transform((data) => {
    // 兼容旧客户端：仅传 tiers 时合并为 gradients
    if (
      (data.gradients === undefined || data.gradients.length === 0) &&
      data.tiers &&
      data.tiers.length > 0
    ) {
      const { tiers, ...rest } = data;
      return { ...rest, gradients: tiers };
    }
    return data;
  })
  .refine(
    (data) =>
      (data.gradients !== undefined && data.gradients.length > 0) ||
      (data.tiers !== undefined && data.tiers.length > 0),
    { message: 'gradients 或 tiers 至少提供一个', path: ['gradients'] },
  );

// ─── points_recharge ──────────────────────────────────────────────

export const pointsRechargeParamsSchema = z
  .object({
    /** 积分兑换比例（百分比） */
    rechargeRatioPercent: z.number().positive().optional(),
    /** 兼容旧字段 */
    pointsRatio: z.number().positive().optional(),
  })
  .merge(bannerFieldsSchema)
  .passthrough()
  .refine(
    (d) => d.rechargeRatioPercent !== undefined || d.pointsRatio !== undefined,
    {
      message: 'rechargeRatioPercent 或 pointsRatio 至少提供一个',
      path: ['rechargeRatioPercent'],
    },
  )
  .transform((data) => {
    // B3：归一化旧字段 pointsRatio → canonical 字段 rechargeRatioPercent
    if (
      data.rechargeRatioPercent === undefined &&
      data.pointsRatio !== undefined
    ) {
      return { ...data, rechargeRatioPercent: data.pointsRatio };
    }
    return data;
  });

// ─── free / points_2x ─────────────────────────────────────────────

export const emptyParamsSchema = bannerFieldsSchema.passthrough();

// ─── 按 type 分发的 union schema ──────────────────────────────────

export const promotionParamsSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('discount'), params: discountParamsSchema }),
  z.object({
    type: z.literal('discount_day'),
    params: discountParamsSchema,
  }),
  z.object({
    type: z.literal('first_order_discount'),
    params: firstOrderDiscountParamsSchema,
  }),
  z.object({ type: z.literal('reduce'), params: reduceParamsSchema }),
  z.object({
    type: z.literal('recharge_gift'),
    params: rechargeGiftParamsSchema,
  }),
  z.object({
    type: z.literal('points_recharge'),
    params: pointsRechargeParamsSchema,
  }),
  z.object({ type: z.literal('free'), params: emptyParamsSchema }),
  z.object({ type: z.literal('points_2x'), params: emptyParamsSchema }),
]);

export type DiscountParams = z.infer<typeof discountParamsSchema>;
export type FirstOrderDiscountParams = z.infer<
  typeof firstOrderDiscountParamsSchema
>;
export type ReduceParams = z.infer<typeof reduceParamsSchema>;
export type RechargeGiftParams = z.infer<typeof rechargeGiftParamsSchema>;
export type PointsRechargeParams = z.infer<typeof pointsRechargeParamsSchema>;

// ─── 校验入口 ─────────────────────────────────────────────────────

/**
 * 按 promotion type 校验 params JSON
 * 严格模式：用于 create / update 入参校验，校验失败抛出 ZodError
 */
export function validatePromotionParams(
  type: string,
  params: unknown,
): Record<string, unknown> {
  const result = promotionParamsSchema.safeParse({
    type,
    params: params ?? {},
  });
  if (!result.success) {
    // B2：将 ZodError 转为 BadRequestException (400)，避免被全局过滤器吞为 500
    const messages = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    );
    throw new BadRequestException(messages.join('; '));
  }
  return result.data.params;
}

/**
 * 按 promotion type 安全解析 params JSON
 * 宽松模式：用于读取时，校验失败返回 null 而非抛错
 */
export function safeParsePromotionParams(
  type: string,
  params: unknown,
): Record<string, unknown> | null {
  const result = promotionParamsSchema.safeParse({
    type,
    params: params ?? {},
  });
  if (!result.success) {
    return null;
  }
  return result.data.params;
}
