// 会员详情「会员运营统计」取数口径单测：会员数与等级分布必须排除已软删除客户，
// 与商家端会员列表、会员列表「按会员数量」排序保持同一口径。
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminClubStatsService } from './membership-admin-club-stats.service';

const buildPrismaMock = (): {
  store: { findUnique: jest.Mock };
  marketingCustomer: { aggregate: jest.Mock; groupBy: jest.Mock };
  marketingRecharge: { aggregate: jest.Mock };
} => ({
  store: { findUnique: jest.fn().mockResolvedValue({ id: 18 }) },
  marketingCustomer: {
    aggregate: jest
      .fn()
      .mockResolvedValue({ _count: { id: 3 }, _sum: { balance: 500 } }),
    groupBy: jest
      .fn()
      .mockResolvedValue([{ tier: 'regular', _count: { id: 3 } }]),
  },
  marketingRecharge: {
    aggregate: jest
      .fn()
      .mockResolvedValue({ _sum: { amount: 0 }, _count: { id: 0 } }),
  },
});

const buildService = () => {
  const prismaMock = buildPrismaMock();
  const accessService = {
    canAccessAdminMember: jest.fn().mockResolvedValue(true),
  } as unknown as PulseMembershipAccessService;
  const service = new PulseMembershipAdminClubStatsService(
    prismaMock as unknown as PrismaService,
    accessService,
  );

  return { service, prismaMock };
};

describe('PulseMembershipAdminClubStatsService', () => {
  it('会员数与等级分布排除已软删除客户', async () => {
    const { service, prismaMock } = buildService();

    const result = await service.getAdminMemberClubStats(
      { sub: 1 } as unknown as AuthenticatedUser,
      18,
    );

    expect(prismaMock.marketingCustomer.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 18, deletedAt: null } }),
    );
    expect(prismaMock.marketingCustomer.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 18, deletedAt: null } }),
    );
    expect(result.totalMemberCount).toBe(3);
    expect(result.levelBreakdown.free).toBe(3);
    expect(result.pendingBalanceFen).toBe(500);
  });

  it('无权访问时抛 403，不落到会员统计查询', async () => {
    const prismaMock = buildPrismaMock();
    const accessService = {
      canAccessAdminMember: jest.fn().mockResolvedValue(false),
    } as unknown as PulseMembershipAccessService;
    const service = new PulseMembershipAdminClubStatsService(
      prismaMock as unknown as PrismaService,
      accessService,
    );

    await expect(
      service.getAdminMemberClubStats(
        { sub: 1 } as unknown as AuthenticatedUser,
        18,
      ),
    ).rejects.toThrow('暂无权限查看会员运营数据');
    expect(prismaMock.marketingCustomer.aggregate).not.toHaveBeenCalled();
  });
});
