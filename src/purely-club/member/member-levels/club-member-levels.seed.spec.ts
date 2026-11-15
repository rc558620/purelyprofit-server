import type { PrismaService } from '../../../prisma/prisma.service';
import type { MarketingMemberLevelConfigValue } from '../../../purely-profit/marketing/marketing.utils';
import type { ClubMemberSnapshot } from '../member-profile/club-member-profile.service';
import { ClubMemberLevelsService } from './club-member-levels.service';

/**
 * 3-B-4：请求级等级配置种子（首页一次加载只读一次配置）的语义约束。
 *
 * 种子只是「同一份原始配置」的搬运，必须保证：
 * 1. 传种子与不传种子的解析结果逐字段一致（含已停用但顾客仍持有的等级）；
 * 2. 传种子时不再回源配置表；
 * 3. in-flight 并发去重仍然生效（其它接口依赖它）。
 */
describe('ClubMemberLevelsService 请求级等级配置种子', () => {
  const storeId = 11;

  /** gold 启用、platinum 启用、diamond 停用 */
  const LEVELS: MarketingMemberLevelConfigValue[] = [
    {
      id: 'gold',
      name: '黄金会员',
      discountRate: 0.9,
      discountRatePct: 90,
      spendThreshold: 0,
      description: '充值即享 9 折优惠',
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
      enabled: false,
      updatedAt: 1_700_000_000_000,
    },
  ];

  const buildSnapshot = (
    overrides: Partial<ClubMemberSnapshot> = {},
  ): ClubMemberSnapshot => ({
    customerId: 88,
    memberId: 201,
    storeId,
    balance: 0,
    level: 'gold',
    points: 0,
    memberCode: 'PC20260101001',
    joinDate: '2026-01-01',
    totalConsume: 0,
    ...overrides,
  });

  const buildService = (): {
    service: ClubMemberLevelsService;
    findUnique: jest.Mock;
  } => {
    const findUnique = jest.fn().mockResolvedValue({ levels: LEVELS });
    const prisma = {
      marketingMemberLevelSetting: { findUnique },
    } as unknown as PrismaService;
    return { service: new ClubMemberLevelsService(prisma), findUnique };
  };

  it('传种子时不再读取配置表', async () => {
    const { service, findUnique } = buildService();

    await service.resolveLevelResolution(buildSnapshot(), LEVELS);
    await service.resolveCurrentLevelConfig(buildSnapshot(), LEVELS);
    service.listConfigsFromSettings(LEVELS);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it('种子与自行读取的等级列表结果完全一致', async () => {
    const { service } = buildService();

    const fromSeed = service.listConfigsFromSettings(LEVELS);
    const fromStore = await service.listConfigs(storeId);

    expect(fromSeed).toEqual(fromStore);
    // 停用等级不进入可见列表
    expect(fromSeed.map((config) => config.level)).toEqual([
      'gold',
      'platinum',
    ]);
  });

  it('已停用但顾客仍持有：种子解析与自行读取结果一致，heldLevelLabel 不丢', async () => {
    const { service } = buildService();
    const snapshot = buildSnapshot({ level: 'diamond', totalConsume: 6_000 });

    const withSeed = await service.resolveLevelResolution(snapshot, LEVELS);
    const withoutSeed = await service.resolveLevelResolution(snapshot);

    expect(withSeed).toEqual(withoutSeed);
    expect(withSeed).toEqual(
      expect.objectContaining({
        heldLevel: 'diamond',
        heldLevelLabel: '钻石会员',
        heldLevelVisible: false,
        // 累计充值 6000 ≥ diamond 门槛，但 diamond 已停用 → 可见等级里取 platinum
        currentLevelConfig: expect.objectContaining({ level: 'platinum' }),
      }),
    );
    expect(withSeed.visibleLevelConfigs.map((config) => config.level)).toEqual([
      'gold',
      'platinum',
    ]);
  });

  it('商品定价用的折扣率与自行读取结果一致', async () => {
    const { service } = buildService();
    const snapshot = buildSnapshot({ totalConsume: 1_500 });

    const withSeed = await service.resolveCurrentLevelConfig(snapshot, LEVELS);
    const withoutSeed = await service.resolveCurrentLevelConfig(snapshot);

    expect(withSeed).toEqual(withoutSeed);
    expect(withSeed.discountRate).toBe(0.85);
  });

  it('in-flight 去重仍生效：同一门店的并发读取只查一次库', async () => {
    const { service, findUnique } = buildService();

    const [first, second] = await Promise.all([
      service.listConfigs(storeId),
      service.resolveLevelResolution(buildSnapshot()),
    ]);

    expect(first).toEqual(second.visibleLevelConfigs);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
