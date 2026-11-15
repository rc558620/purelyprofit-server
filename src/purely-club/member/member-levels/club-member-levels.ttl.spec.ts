import type { PrismaService } from '../../../prisma/prisma.service';
import type { MarketingMemberLevelConfigValue } from '../../../purely-profit/marketing/marketing.utils';
import { CLUB_LEVEL_SETTINGS_CACHE_TTL_MS } from './club-member-levels.cache';
import { ClubMemberLevelsService } from './club-member-levels.service';

/**
 * 3-B-2：等级配置 TTL 缓存在 service 层的行为。
 *
 * 必须保证三件事：
 * 1. TTL 内同一门店只回源一次（缓存真的生效）；
 * 2. TTL 到期后立即回源，后台改配置最长 3s 内可见（延迟有界且可预测）；
 * 3. 回源失败不写缓存、返回值与缓存互不影响（缓存不能固化成错误或脏数据）。
 */
describe('ClubMemberLevelsService 等级配置 TTL 缓存', () => {
  const storeId = 11;

  const buildLevels = (
    discountRate: number,
    description = '充值即享 9 折优惠',
  ): MarketingMemberLevelConfigValue[] => [
    {
      id: 'gold',
      name: '黄金会员',
      discountRate,
      discountRatePct: Math.round(discountRate * 100),
      spendThreshold: 0,
      description,
      enabled: true,
      updatedAt: 1_700_000_000_000,
    },
    {
      id: 'platinum',
      name: '铂金会员',
      discountRate: 0.85,
      discountRatePct: 85,
      spendThreshold: 1_000,
      description: '累计充值 ≥ ¥1,000 升级',
      enabled: true,
      updatedAt: 1_700_000_000_000,
    },
    {
      id: 'diamond',
      name: '钻石会员',
      discountRate: 0.8,
      discountRatePct: 80,
      spendThreshold: 5_000,
      description: '累计充值 ≥ ¥5,000 升级',
      enabled: true,
      updatedAt: 1_700_000_000_000,
    },
  ];

  let now: number;

  const buildService = (): {
    service: ClubMemberLevelsService;
    findUnique: jest.Mock;
  } => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ levels: buildLevels(0.9) });
    const prisma = {
      marketingMemberLevelSetting: { findUnique },
    } as unknown as PrismaService;
    return { service: new ClubMemberLevelsService(prisma), findUnique };
  };

  beforeEach(() => {
    now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('TTL 内同一门店只回源一次', async () => {
    const { service, findUnique } = buildService();

    await service.loadLevelSettings(storeId);
    now += CLUB_LEVEL_SETTINGS_CACHE_TTL_MS - 1;
    await service.loadLevelSettings(storeId);
    await service.listConfigs(storeId);

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('TTL 到期后重新回源，后台改配置最长 3s 内可见', async () => {
    const { service, findUnique } = buildService();
    findUnique
      .mockResolvedValueOnce({ levels: buildLevels(0.9) })
      .mockResolvedValueOnce({ levels: buildLevels(0.88) });

    const before = await service.listConfigs(storeId);
    expect(before[0].discountRate).toBe(0.9);

    // 未到期：仍是旧配置（延迟有界，不是永久）
    now += CLUB_LEVEL_SETTINGS_CACHE_TTL_MS - 1;
    const withinTtl = await service.listConfigs(storeId);
    expect(withinTtl[0].discountRate).toBe(0.9);

    // 到期：立即读到新配置
    now += 1;
    const afterExpiry = await service.listConfigs(storeId);
    expect(afterExpiry[0].discountRate).toBe(0.88);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('回源失败不写缓存，下一次请求会重试', async () => {
    const { service, findUnique } = buildService();
    findUnique.mockRejectedValueOnce(new Error('等级配置表不可用'));

    await expect(service.listConfigs(storeId)).rejects.toThrow(
      '等级配置表不可用',
    );

    findUnique.mockResolvedValue({ levels: buildLevels(0.9) });
    await expect(service.listConfigs(storeId)).resolves.toHaveLength(3);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('调用方修改返回值不会污染缓存', async () => {
    const { service } = buildService();

    const first = await service.loadLevelSettings(storeId);
    first[0].discountRate = 0.1;
    first.length = 1;

    const second = await service.loadLevelSettings(storeId);
    expect(second).toHaveLength(3);
    expect(second[0].discountRate).toBe(0.9);
  });

  it('不同门店各自独立缓存', async () => {
    const { service, findUnique } = buildService();

    await service.loadLevelSettings(11);
    await service.loadLevelSettings(12);

    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { storeId: 11 } }),
    );
    expect(findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { storeId: 12 } }),
    );
  });
});
