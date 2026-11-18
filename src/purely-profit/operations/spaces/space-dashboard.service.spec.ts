import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { buildSpacesDashboardStatsCacheKey } from '../../../redis/cache-keys';
import { SpaceDashboardService } from './space-dashboard.service';
import { SpaceDashboardSummaryService } from './space-dashboard-summary.service';
import { createSpaceTestUser } from './space-session.spec-helpers';

/**
 * 看板轻量统计接口：首屏统计条只消费 stats，
 * 不允许退化成完整看板（会为每个空间组装主/未来预约摘要）。
 */
describe('SpaceDashboardService 轻量统计', () => {
  let service: SpaceDashboardService;

  const prismaService = {
    space: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
  };
  const summaryService = {
    buildTodaySettledSessionStats: jest.fn(),
    buildDashboardSpaceSummaryBundle: jest.fn(),
  };
  const refreshableCache = {
    getOrLoadRefreshableJson: jest.fn(
      async (options: { loadValue: () => Promise<unknown> }) =>
        options.loadValue(),
    ),
  };

  const user = createSpaceTestUser();

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.space.findMany.mockResolvedValue([]);
    prismaService.$queryRaw.mockResolvedValue([]);
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    summaryService.buildTodaySettledSessionStats.mockResolvedValue({
      todaySettled: 0,
      todayRevenue: 0,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceDashboardService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: SpaceDashboardSummaryService,
          useValue: summaryService,
        },
        { provide: RefreshableCacheService, useValue: refreshableCache },
      ],
    }).compile();

    service = module.get<SpaceDashboardService>(SpaceDashboardService);
    Object.assign(service as object, {
      logger: { log: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    });
  });

  it('只组装 stats，不调用看板摘要聚合', async () => {
    prismaService.space.findMany.mockResolvedValue([
      {
        id: 1,
        enableDirtyRoom: false,
        cleanedAt: null,
        sortOrder: 1,
        type: { id: 1, name: '台球桌' },
        zone: null,
        _count: { sessions: 1, reservations: 0 },
      },
    ]);
    summaryService.buildTodaySettledSessionStats.mockResolvedValue({
      todaySettled: 3,
      todayRevenue: 128.5,
    });

    const stats = await service.getSpacesDashboardStats(user, {});

    expect(stats).toMatchObject({
      total: 1,
      occupied: 1,
      idle: 0,
      todaySettled: 3,
      todayRevenue: 128.5,
    });
    // 完整看板才有的一段聚合，轻量接口不得触发
    expect(
      summaryService.buildDashboardSpaceSummaryBundle,
    ).not.toHaveBeenCalled();
  });

  it('使用独立的统计缓存键，避免与完整看板互相覆盖', async () => {
    await service.getSpacesDashboardStats(user, {});

    expect(refreshableCache.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: buildSpacesDashboardStatsCacheKey(18),
      }),
    );
  });

  it('无门店权限时返回空统计且不查库', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    const stats = await service.getSpacesDashboardStats(user, {});

    expect(stats).toMatchObject({
      total: 0,
      idle: 0,
      occupied: 0,
      todaySettled: 0,
      todayRevenue: 0,
    });
    expect(prismaService.space.findMany).not.toHaveBeenCalled();
  });
});
