import {
  memberLevelConfigSchema,
  memberLevelsSchema,
  pointsRatioConfigSchema,
  pointsRatioSchema,
  safeParseLevels,
  safeParsePointsRatio,
  safeParseMemberLevelSettings,
  strictParseLevels,
  strictParsePointsRatio,
} from './member-level-settings.schema';
import { DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS } from '../marketing.utils';

// ─── memberLevelConfigSchema ─────────────────────────────────────

describe('memberLevelConfigSchema', () => {
  it('accepts valid level config', () => {
    const result = memberLevelConfigSchema.safeParse({
      id: 'gold',
      name: '黄金会员',
      discountRate: 0.9,
      discountRatePct: 90,
      spendThreshold: 0,
      description: '充值即享 9 折优惠',
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid level config without optional discountRatePct', () => {
    const result = memberLevelConfigSchema.safeParse({
      id: 'gold',
      name: '黄金会员',
      discountRate: 0.9,
      spendThreshold: 0,
      description: '充值即享 9 折优惠',
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid id', () => {
    const result = memberLevelConfigSchema.safeParse({
      id: 'invalid',
      name: '无效等级',
      discountRate: 0.9,
      spendThreshold: 0,
      description: '',
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects discountRatePct out of range', () => {
    const result = memberLevelConfigSchema.safeParse({
      id: 'gold',
      name: '黄金会员',
      discountRate: 0.9,
      discountRatePct: 150,
      spendThreshold: 0,
      description: '',
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects discountRate out of range', () => {
    const result = memberLevelConfigSchema.safeParse({
      id: 'gold',
      name: '黄金会员',
      discountRate: 1.5,
      spendThreshold: 0,
      description: '',
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative spendThreshold', () => {
    const result = memberLevelConfigSchema.safeParse({
      id: 'gold',
      name: '黄金会员',
      discountRate: 0.9,
      spendThreshold: -100,
      description: '',
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ─── memberLevelsSchema ──────────────────────────────────────────

describe('memberLevelsSchema', () => {
  it('accepts valid levels array', () => {
    const result = memberLevelsSchema.safeParse(
      DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels,
    );
    expect(result.success).toBe(true);
  });

  it('returns default when parsing undefined', () => {
    const result = memberLevelsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(3);
    }
  });
});

// ─── pointsRatioConfigSchema ─────────────────────────────────────

describe('pointsRatioConfigSchema', () => {
  it('accepts valid points ratio config', () => {
    const result = pointsRatioConfigSchema.safeParse({
      earnRatioCents: 100,
      earnRatioYuan: 100,
      redeemRatioPoints: 1,
      maxRedeemRatio: 0.5,
      maxRedeemPct: 50,
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid points ratio config without optional fields', () => {
    const result = pointsRatioConfigSchema.safeParse({
      earnRatioCents: 100,
      redeemRatioPoints: 1,
      maxRedeemRatio: 0.5,
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects zero earnRatioCents', () => {
    const result = pointsRatioConfigSchema.safeParse({
      earnRatioCents: 0,
      redeemRatioPoints: 1,
      maxRedeemRatio: 0.5,
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects maxRedeemPct out of range', () => {
    const result = pointsRatioConfigSchema.safeParse({
      earnRatioCents: 100,
      redeemRatioPoints: 1,
      maxRedeemRatio: 0.5,
      maxRedeemPct: 150,
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects maxRedeemRatio > 1', () => {
    const result = pointsRatioConfigSchema.safeParse({
      earnRatioCents: 100,
      redeemRatioPoints: 1,
      maxRedeemRatio: 1.5,
      enabled: true,
      updatedAt: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ─── pointsRatioSchema ───────────────────────────────────────────

describe('pointsRatioSchema', () => {
  it('returns default when parsing undefined', () => {
    const result = pointsRatioSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.earnRatioCents).toBe(100);
      expect(result.data.earnRatioYuan).toBe(100);
      expect(result.data.maxRedeemPct).toBe(50);
    }
  });
});

// ─── safeParseLevels ─────────────────────────────────────────────

describe('safeParseLevels', () => {
  it('returns parsed levels for valid input', () => {
    const result = safeParseLevels(
      DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels,
    );
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('gold');
  });

  it('returns default levels for invalid input', () => {
    const result = safeParseLevels('invalid');
    expect(result).toHaveLength(3);
  });

  it('returns default levels for null input', () => {
    const result = safeParseLevels(null);
    expect(result).toHaveLength(3);
  });

  it('B-M1: 单条非法等级仅兑底该条，不影响其余合法等级', () => {
    const raw = [
      { ...DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels[0] }, // gold: valid
      {
        ...DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels[1],
        discountRate: 1.5,
      }, // platinum: invalid
      { ...DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels[2] }, // diamond: valid
    ];
    const result = safeParseLevels(raw);
    expect(result).toHaveLength(3);
    // gold 保持原值
    expect(result[0].id).toBe('gold');
    expect(result[0].discountRate).toBe(0.9);
    // platinum 兑底为默认值（非法字段被丢弃）
    expect(result[1].id).toBe('platinum');
    expect(result[1].discountRate).toBe(
      DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels[1].discountRate,
    );
    // diamond 保持原值
    expect(result[2].id).toBe('diamond');
    expect(result[2].discountRate).toBe(0.8);
  });

  it('B-M1: 多条非法等级各自兑底为默认值', () => {
    const raw = [
      {
        id: 'gold',
        name: '',
        discountRate: 0.9,
        spendThreshold: 0,
        description: '',
        enabled: true,
        updatedAt: 0,
      }, // name='' invalid
      {
        id: 'platinum',
        name: '铂金',
        discountRate: 1.5,
        spendThreshold: 5000,
        description: '',
        enabled: true,
        updatedAt: 0,
      }, // discountRate invalid
      {
        id: 'diamond',
        name: '钻石',
        discountRate: 0.8,
        spendThreshold: 10000,
        description: '',
        enabled: true,
        updatedAt: 0,
      }, // valid
    ];
    const result = safeParseLevels(raw);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(
      DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels[0],
    );
    expect(result[1]).toEqual(
      DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels[1],
    );
    expect(result[2].name).toBe('钻石');
  });
});

// ─── safeParsePointsRatio ────────────────────────────────────────

describe('safeParsePointsRatio', () => {
  it('returns parsed pointsRatio for valid input', () => {
    const result = safeParsePointsRatio({
      earnRatioCents: 200,
      earnRatioYuan: 200,
      redeemRatioPoints: 100,
      maxRedeemRatio: 0.3,
      maxRedeemPct: 30,
      enabled: false,
      updatedAt: 12345,
    });
    expect(result.earnRatioCents).toBe(200);
    expect(result.earnRatioYuan).toBe(200);
    expect(result.maxRedeemPct).toBe(30);
    expect(result.enabled).toBe(false);
  });

  it('returns default for invalid input', () => {
    const result = safeParsePointsRatio('invalid');
    expect(result.earnRatioCents).toBe(
      DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio.earnRatioCents,
    );
  });

  it('returns default for null input', () => {
    const result = safeParsePointsRatio(null);
    expect(result.earnRatioCents).toBe(
      DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio.earnRatioCents,
    );
  });
});

// ─── safeParseMemberLevelSettings ────────────────────────────────

describe('safeParseMemberLevelSettings', () => {
  it('returns parsed settings for valid input', () => {
    const result = safeParseMemberLevelSettings({
      levels: DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels,
      pointsRatio: DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio,
    });
    expect(result.levels).toHaveLength(3);
    expect(result.pointsRatio.earnRatioCents).toBe(100);
    expect(result.pointsRatio.earnRatioYuan).toBe(100);
    expect(result.pointsRatio.maxRedeemPct).toBe(50);
  });

  it('returns default for null input', () => {
    const result = safeParseMemberLevelSettings(null);
    expect(result.levels).toHaveLength(3);
  });

  it('returns default for invalid input', () => {
    const result = safeParseMemberLevelSettings({
      levels: 'invalid',
      pointsRatio: 'invalid',
    });
    expect(result.levels).toHaveLength(3);
  });
});

// ─── strictParseLevels (B-M2) ──────────────────────────────────

describe('strictParseLevels', () => {
  it('accepts valid levels array', () => {
    const result = strictParseLevels(
      DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels,
    );
    expect(result).toHaveLength(3);
  });

  it('throws on invalid element', () => {
    const raw = [
      ...DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels.slice(0, 2),
      {
        ...DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels[2],
        discountRate: 1.5,
      },
    ];
    expect(() => strictParseLevels(raw)).toThrow();
  });

  it('throws on empty array', () => {
    expect(() => strictParseLevels([])).toThrow();
  });
});

// ─── strictParsePointsRatio (B-M2) ─────────────────────────────

describe('strictParsePointsRatio', () => {
  it('accepts valid pointsRatio', () => {
    const result = strictParsePointsRatio(
      DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio,
    );
    expect(result.earnRatioCents).toBe(100);
  });

  it('throws on invalid earnRatioCents', () => {
    expect(() =>
      strictParsePointsRatio({
        ...DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio,
        earnRatioCents: 0,
      }),
    ).toThrow();
  });
});
