import type { MarketingMemberLevelConfigValue } from '../../../purely-profit/marketing/marketing.utils';
import {
  CLUB_LEVEL_SETTINGS_CACHE_MAX_STORES,
  CLUB_LEVEL_SETTINGS_CACHE_TTL_MS,
  ClubLevelSettingsTtlCache,
  cloneLevelSettings,
} from './club-member-levels.cache';

/**
 * 3-B-2：等级配置进程内 TTL 缓存。
 *
 * 关键约束：TTL 边界准确、条目上限不会无界增长、对外返回值与缓存互不影响。
 */
describe('ClubLevelSettingsTtlCache', () => {
  const buildLevels = (
    discountRate: number,
  ): MarketingMemberLevelConfigValue[] => [
    {
      id: 'gold',
      name: '黄金会员',
      discountRate,
      discountRatePct: Math.round(discountRate * 100),
      spendThreshold: 0,
      description: '充值即享',
      enabled: true,
      updatedAt: 1_700_000_000_000,
    },
  ];

  let now: number;

  beforeEach(() => {
    now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('TTL 内命中，到期后失效并删除条目', () => {
    const cache = new ClubLevelSettingsTtlCache(1_000, 10);
    const levels = buildLevels(0.9);
    cache.set(11, levels);

    now += 999;
    expect(cache.get(11)).toBe(levels);

    now += 1;
    expect(cache.get(11)).toBeNull();
  });

  it('未写入过的门店返回 null', () => {
    const cache = new ClubLevelSettingsTtlCache();

    expect(cache.get(11)).toBeNull();
  });

  it('默认 TTL 与上限取自常量', () => {
    expect(CLUB_LEVEL_SETTINGS_CACHE_TTL_MS).toBe(3_000);
    expect(CLUB_LEVEL_SETTINGS_CACHE_MAX_STORES).toBe(1_000);

    const cache = new ClubLevelSettingsTtlCache();
    cache.set(11, buildLevels(0.9));
    now += CLUB_LEVEL_SETTINGS_CACHE_TTL_MS - 1;
    expect(cache.get(11)).not.toBeNull();
    now += 1;
    expect(cache.get(11)).toBeNull();
  });

  it('超过条目上限时优先清理过期项，不做无界增长', () => {
    const cache = new ClubLevelSettingsTtlCache(1_000, 2);
    cache.set(1, buildLevels(0.9));
    cache.set(2, buildLevels(0.9));

    now += 1_500;
    cache.set(3, buildLevels(0.9));

    expect(cache.get(1)).toBeNull();
    expect(cache.get(2)).toBeNull();
    expect(cache.get(3)).not.toBeNull();
  });

  it('无过期项可清时淘汰最早写入项', () => {
    const cache = new ClubLevelSettingsTtlCache(10_000, 2);
    cache.set(1, buildLevels(0.9));
    cache.set(2, buildLevels(0.9));

    cache.set(3, buildLevels(0.9));

    expect(cache.get(1)).toBeNull();
    expect(cache.get(2)).not.toBeNull();
    expect(cache.get(3)).not.toBeNull();
  });

  it('clear 清空全部条目', () => {
    const cache = new ClubLevelSettingsTtlCache();
    cache.set(11, buildLevels(0.9));

    cache.clear();

    expect(cache.get(11)).toBeNull();
  });

  it('cloneLevelSettings 返回独立副本，修改不影响原数组', () => {
    const source = buildLevels(0.9);

    const cloned = cloneLevelSettings(source);
    cloned[0].discountRate = 0.1;
    cloned.push(buildLevels(0.5)[0]);

    expect(source).toHaveLength(1);
    expect(source[0].discountRate).toBe(0.9);
    expect(cloned).not.toBe(source);
    expect(cloned[0]).not.toBe(source[0]);
  });
});
