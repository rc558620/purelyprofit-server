import {
  discountParamsSchema,
  firstOrderDiscountParamsSchema,
  reduceParamsSchema,
  rechargeGiftParamsSchema,
  pointsRechargeParamsSchema,
  emptyParamsSchema,
  promotionParamsSchema,
  validatePromotionParams,
  safeParsePromotionParams,
} from './promotion-params.schema';

// ─── discount ────────────────────────────────────────────────────

describe('discountParamsSchema', () => {
  it('accepts valid discountRate (0-100 integer)', () => {
    const result = discountParamsSchema.safeParse({
      discountRate: 80,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountRate).toBe(80);
    }
  });

  it('accepts discountRate with bannerImage', () => {
    const result = discountParamsSchema.safeParse({
      discountRate: 90,
      bannerImage: 'https://example.com/banner.jpg',
    });
    expect(result.success).toBe(true);
  });

  it('rejects discountRate out of range (0)', () => {
    const result = discountParamsSchema.safeParse({
      discountRate: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects discountRate out of range (100)', () => {
    const result = discountParamsSchema.safeParse({
      discountRate: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer discountRate', () => {
    const result = discountParamsSchema.safeParse({
      discountRate: 80.5,
    });
    expect(result.success).toBe(false);
  });
});

// ─── first_order_discount ────────────────────────────────────────

describe('firstOrderDiscountParamsSchema', () => {
  it('accepts valid first_order_discount params', () => {
    const result = firstOrderDiscountParamsSchema.safeParse({
      discountRate: 80,
      audience: 'first_order',
    });
    expect(result.success).toBe(true);
  });

  it('accepts first_order_discount without audience', () => {
    const result = firstOrderDiscountParamsSchema.safeParse({
      discountRate: 90,
    });
    expect(result.success).toBe(true);
  });
});

// ─── reduce ──────────────────────────────────────────────────────

describe('reduceParamsSchema', () => {
  it('accepts valid reduce params', () => {
    const result = reduceParamsSchema.safeParse({
      threshold: 10000,
      reduceAmount: 2000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threshold).toBe(10000);
      expect(result.data.reduceAmount).toBe(2000);
    }
  });

  it('rejects zero threshold', () => {
    const result = reduceParamsSchema.safeParse({
      threshold: 0,
      reduceAmount: 2000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing reduceAmount', () => {
    const result = reduceParamsSchema.safeParse({
      threshold: 10000,
    });
    expect(result.success).toBe(false);
  });
});

// ─── recharge_gift ───────────────────────────────────────────────

describe('rechargeGiftParamsSchema', () => {
  it('accepts valid gradients', () => {
    const result = rechargeGiftParamsSchema.safeParse({
      gradients: [
        { rechargeAmount: 10000, giftAmount: 1000 },
        { rechargeAmount: 30000, giftAmount: 5000 },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gradients).toHaveLength(2);
    }
  });

  it('rejects empty gradients array', () => {
    const result = rechargeGiftParamsSchema.safeParse({
      gradients: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts gradients with giftRatio', () => {
    const result = rechargeGiftParamsSchema.safeParse({
      gradients: [{ rechargeAmount: 10000, giftRatio: 0.1 }],
    });
    expect(result.success).toBe(true);
  });
});

// ─── points_recharge ─────────────────────────────────────────────

describe('pointsRechargeParamsSchema', () => {
  it('accepts valid points_recharge params', () => {
    const result = pointsRechargeParamsSchema.safeParse({
      rechargeRatioPercent: 10,
    });
    expect(result.success).toBe(true);
  });

  it('accepts pointsRatio field', () => {
    const result = pointsRechargeParamsSchema.safeParse({
      pointsRatio: 5,
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (passthrough)', () => {
    const result = pointsRechargeParamsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ─── free / points_2x ────────────────────────────────────────────

describe('emptyParamsSchema', () => {
  it('accepts empty object', () => {
    const result = emptyParamsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts object with bannerImage', () => {
    const result = emptyParamsSchema.safeParse({
      bannerImage: 'https://example.com/banner.jpg',
    });
    expect(result.success).toBe(true);
  });
});

// ─── promotionParamsSchema (union) ───────────────────────────────

describe('promotionParamsSchema', () => {
  it('validates discount type', () => {
    const result = promotionParamsSchema.safeParse({
      type: 'discount',
      params: { discountRate: 80 },
    });
    expect(result.success).toBe(true);
  });

  it('validates reduce type', () => {
    const result = promotionParamsSchema.safeParse({
      type: 'reduce',
      params: { threshold: 10000, reduceAmount: 2000 },
    });
    expect(result.success).toBe(true);
  });

  it('validates recharge_gift type', () => {
    const result = promotionParamsSchema.safeParse({
      type: 'recharge_gift',
      params: {
        gradients: [{ rechargeAmount: 10000, giftAmount: 1000 }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('validates free type', () => {
    const result = promotionParamsSchema.safeParse({
      type: 'free',
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid params for type', () => {
    const result = promotionParamsSchema.safeParse({
      type: 'discount',
      params: { threshold: 10000 },
    });
    expect(result.success).toBe(false);
  });
});

// ─── validatePromotionParams ─────────────────────────────────────

describe('validatePromotionParams', () => {
  it('returns parsed params on success', () => {
    const result = validatePromotionParams('discount', { discountRate: 80 });
    expect(result.discountRate).toBe(80);
  });

  it('throws on invalid params', () => {
    expect(() =>
      validatePromotionParams('discount', { threshold: 10000 }),
    ).toThrow();
  });

  it('validates reduce params', () => {
    const result = validatePromotionParams('reduce', {
      threshold: 10000,
      reduceAmount: 2000,
    });
    expect(result.threshold).toBe(10000);
    expect(result.reduceAmount).toBe(2000);
  });
});

// ─── safeParsePromotionParams ────────────────────────────────────

describe('safeParsePromotionParams', () => {
  it('returns parsed params on success', () => {
    const result = safeParsePromotionParams('discount', {
      discountRate: 80,
    });
    expect(result).not.toBeNull();
    expect(result!.discountRate).toBe(80);
  });

  it('returns null on failure', () => {
    const result = safeParsePromotionParams('discount', {
      threshold: 10000,
    });
    expect(result).toBeNull();
  });
});
