import { buildPromotionDisplayText } from './marketing.mapper';
import type { MarketingPromotionParamsValue } from './marketing.utils';

describe('buildPromotionDisplayText', () => {
  // ─── discount ────────────────────────────────────────────────────

  describe('discount / discount_day', () => {
    it('discount: discountRate=80 → "打 8 折"', () => {
      expect(buildPromotionDisplayText('discount', { discountRate: 80 })).toBe(
        '打 8 折',
      );
    });

    it('discount: discountRate=85 → "打 8.5 折"', () => {
      expect(buildPromotionDisplayText('discount', { discountRate: 85 })).toBe(
        '打 8.5 折',
      );
    });

    it('discount: 旧格式 rate=0.8 → 兼容转换为 "打 8 折"', () => {
      expect(buildPromotionDisplayText('discount', { rate: 0.8 })).toBe(
        '打 8 折',
      );
    });

    it('discount_day: discountRate=70 → "打 7 折"', () => {
      expect(
        buildPromotionDisplayText('discount_day', { discountRate: 70 }),
      ).toBe('打 7 折');
    });

    it('缺少参数时返回空字符串', () => {
      expect(buildPromotionDisplayText('discount', {})).toBe('');
    });
  });

  // ─── reduce ──────────────────────────────────────────────────────

  describe('reduce', () => {
    it('threshold=50 reduceAmount=8 → "满 ¥50 减 ¥8"', () => {
      expect(
        buildPromotionDisplayText('reduce', {
          threshold: 50,
          reduceAmount: 8,
        }),
      ).toBe('满 ¥50 减 ¥8');
    });

    it('threshold=100 reduceAmount=15 → "满 ¥100 减 ¥15"', () => {
      expect(
        buildPromotionDisplayText('reduce', {
          threshold: 100,
          reduceAmount: 15,
        }),
      ).toBe('满 ¥100 减 ¥15');
    });

    it('缺少 threshold 时返回空字符串', () => {
      expect(buildPromotionDisplayText('reduce', { reduceAmount: 8 })).toBe('');
    });

    it('缺少 reduceAmount 时返回空字符串', () => {
      expect(buildPromotionDisplayText('reduce', { threshold: 50 })).toBe('');
    });
  });

  // ─── recharge_gift ───────────────────────────────────────────────

  describe('recharge_gift', () => {
    it('单档 giftAmount → "充 ¥100 赠 ¥10"', () => {
      expect(
        buildPromotionDisplayText('recharge_gift', {
          gradients: [{ rechargeAmount: 100, giftAmount: 10 }],
        }),
      ).toBe('充 ¥100 赠 ¥10');
    });

    it('多档 gradients → 首档文案追加"起"', () => {
      expect(
        buildPromotionDisplayText('recharge_gift', {
          gradients: [
            { rechargeAmount: 100, giftAmount: 10 },
            { rechargeAmount: 300, giftAmount: 50 },
          ],
        }),
      ).toBe('充 ¥100 赠 ¥10 起');
    });

    it('单档 giftRatio → 由比例推导赠送金额', () => {
      expect(
        buildPromotionDisplayText('recharge_gift', {
          gradients: [{ rechargeAmount: 100, giftRatio: 0.2 }],
        }),
      ).toBe('充 ¥100 赠 ¥20');
    });

    it('giftAmount 优先于 giftRatio', () => {
      expect(
        buildPromotionDisplayText('recharge_gift', {
          gradients: [{ rechargeAmount: 100, giftAmount: 5, giftRatio: 0.2 }],
        }),
      ).toBe('充 ¥100 赠 ¥5');
    });

    it('空 gradients → "多档储值赠送"', () => {
      expect(
        buildPromotionDisplayText('recharge_gift', { gradients: [] }),
      ).toBe('多档储值赠送');
    });

    it('无 gradients → "多档储值赠送"', () => {
      expect(buildPromotionDisplayText('recharge_gift', {})).toBe(
        '多档储值赠送',
      );
    });
  });

  // ─── free ────────────────────────────────────────────────────────

  describe('free', () => {
    it('返回 "免单"', () => {
      expect(buildPromotionDisplayText('free', {})).toBe('免单');
    });
  });

  // ─── first_order_discount ────────────────────────────────────────

  describe('first_order_discount', () => {
    it('discountRate=75 → "首单 7.5 折"', () => {
      expect(
        buildPromotionDisplayText('first_order_discount', {
          discountRate: 75,
          audience: 'first_order',
        }),
      ).toBe('首单 7.5 折');
    });

    it('discountRate=80 → "首单 8 折"（整数不显小数）', () => {
      expect(
        buildPromotionDisplayText('first_order_discount', {
          discountRate: 80,
        }),
      ).toBe('首单 8 折');
    });

    it('旧格式 rate=0.85 → 兼容转换为 "首单 8.5 折"', () => {
      expect(
        buildPromotionDisplayText('first_order_discount', { rate: 0.85 }),
      ).toBe('首单 8.5 折');
    });

    it('缺少参数时返回空字符串', () => {
      expect(buildPromotionDisplayText('first_order_discount', {})).toBe('');
    });
  });

  // ─── points_recharge ─────────────────────────────────────────────

  describe('points_recharge', () => {
    it('rechargeRatioPercent=10 → "充 ¥100 赠 10 积分"', () => {
      expect(
        buildPromotionDisplayText('points_recharge', {
          rechargeRatioPercent: 10,
        }),
      ).toBe('充 ¥100 赠 10 积分');
    });

    it('rechargeRatioPercent=12.5 → "充 ¥100 赠 12.5 积分"', () => {
      expect(
        buildPromotionDisplayText('points_recharge', {
          rechargeRatioPercent: 12.5,
        }),
      ).toBe('充 ¥100 赠 12.5 积分');
    });

    it('rechargeRatioPercent=12.345 → toFixed(2) 后 "充 ¥100 赠 12.35 积分"', () => {
      expect(
        buildPromotionDisplayText('points_recharge', {
          rechargeRatioPercent: 12.345,
        }),
      ).toBe('充 ¥100 赠 12.35 积分');
    });

    it('旧字段 pointsRatio=5 → 兼容为 "充 ¥100 赠 5 积分"', () => {
      expect(
        buildPromotionDisplayText('points_recharge', {
          pointsRatio: 5,
        }),
      ).toBe('充 ¥100 赠 5 积分');
    });

    it('缺少参数时返回空字符串', () => {
      expect(buildPromotionDisplayText('points_recharge', {})).toBe('');
    });
  });

  // ─── points_2x ───────────────────────────────────────────────────

  describe('points_2x', () => {
    it('返回 "双倍积分"', () => {
      expect(buildPromotionDisplayText('points_2x', {})).toBe('双倍积分');
    });
  });

  // ─── 未知类型 ────────────────────────────────────────────────────

  describe('未知类型', () => {
    it('返回空字符串', () => {
      expect(buildPromotionDisplayText('unknown_type', {})).toBe('');
    });
  });

  // ─── 前后端文案一致性验证 ─────────────────────────────────────────

  describe('前后端文案一致性', () => {
    const cases: Array<{
      type: string;
      params: MarketingPromotionParamsValue;
      expected: string;
    }> = [
      { type: 'discount', params: { discountRate: 80 }, expected: '打 8 折' },
      { type: 'discount', params: { discountRate: 85 }, expected: '打 8.5 折' },
      {
        type: 'reduce',
        params: { threshold: 50, reduceAmount: 8 },
        expected: '满 ¥50 减 ¥8',
      },
      {
        type: 'recharge_gift',
        params: { gradients: [{ rechargeAmount: 100, giftAmount: 10 }] },
        expected: '充 ¥100 赠 ¥10',
      },
      {
        type: 'recharge_gift',
        params: {
          gradients: [
            { rechargeAmount: 100, giftAmount: 10 },
            { rechargeAmount: 300, giftAmount: 50 },
          ],
        },
        expected: '充 ¥100 赠 ¥10 起',
      },
      { type: 'free', params: {}, expected: '免单' },
      {
        type: 'first_order_discount',
        params: { discountRate: 75 },
        expected: '首单 7.5 折',
      },
      {
        type: 'points_recharge',
        params: { rechargeRatioPercent: 10 },
        expected: '充 ¥100 赠 10 积分',
      },
    ];

    cases.forEach(({ type, params, expected }) => {
      it(`${type}: ${JSON.stringify(params)} → "${expected}"`, () => {
        expect(buildPromotionDisplayText(type, params)).toBe(expected);
      });
    });
  });
});
