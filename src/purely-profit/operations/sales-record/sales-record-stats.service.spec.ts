import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { SalesRecordStatsService } from './sales-record-stats.service';

describe('SalesRecordStatsService', () => {
  let service: SalesRecordStatsService;

  const prismaService = {
    $queryRaw: jest.fn(),
  };

  const redisService = {
    getOrLoadRefreshableJson: jest.fn(),
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
  };

  const platformMembershipAccessService = {
    clampHistoryRange: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
    jest.clearAllMocks();
    platformMembershipAccessService.clampHistoryRange.mockImplementation(
      (_storeId: number, range: { start: number; end: number }) => ({
        start: range.start,
        end: range.end,
        clamped: false,
        empty: false,
      }),
    );
    redisService.getOrLoadRefreshableJson.mockImplementation(
      async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
        loadValue(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesRecordStatsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<SalesRecordStatsService>(SalesRecordStatsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getStats 返回当前统计与较上期变化', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('200'),
          profit: new Prisma.Decimal('55'),
          order_count: BigInt(4),
        },
      ])
      .mockResolvedValueOnce([
        {
          revenue: new Prisma.Decimal('160'),
          profit: new Prisma.Decimal('44'),
          order_count: BigInt(2),
        },
      ]);

    await expect(
      service.getStats(user, {
        storeId: 18,
        period: 'today',
      }),
    ).resolves.toEqual({
      totalRevenue: 200,
      totalProfit: 55,
      orderCount: 4,
      avgOrderValue: 50,
      compareLastPeriod: 25,
    });
  });

  it('getStats 在无可访问门店时返回空统计', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(
      service.getStats(user, { storeId: 18, period: 'today' }),
    ).resolves.toEqual({
      totalRevenue: 0,
      totalProfit: 0,
      orderCount: 0,
      avgOrderValue: 0,
      compareLastPeriod: null,
    });
    expect(prismaService.$queryRaw).not.toHaveBeenCalled();
  });
});
