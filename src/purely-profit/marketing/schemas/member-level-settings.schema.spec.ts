import {
  memberLevelConfigSchema,
  memberLevelsSchema,
  pointsRatioConfigSchema,
  pointsRatioSchema,
  safeParseLevels,
  safeParsePointsRatio,
  safeParseMemberLevelSettings,
} from './member-level-settings.schema';
import { DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS } from '../marketing.utils';

// ─── memberLevelConfigSchema ─────────────────────────────────────

describe('memberLevelConfigSchema', () => {
  it('accepts valid level config', () => {
    const result = memberLevelConfigSchema.safeParse({
      id: 'gold',
      name: '黄金会员',
      discountRate: 0.9,
      spendThreshold: 0,
      description: '注册即享 9 折优惠',
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
});

// ─── safeParsePointsRatio ────────────────────────────────────────

describe('safeParsePointsRatio', () => {
  it('returns parsed pointsRatio for valid input', () => {
    const result = safeParsePointsRatio({
      earnRatioCents: 200,
      redeemRatioPoints: 100,
      maxRedeemRatio: 0.3,
      enabled: false,
      updatedAt: 12345,
    });
    expect(result.earnRatioCents).toBe(200);
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
