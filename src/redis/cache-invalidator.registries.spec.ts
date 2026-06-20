import { createFinanceCacheInvalidatorRegistry } from './cache-invalidator-finance.providers';
import { createMembershipCacheInvalidatorRegistry } from './cache-invalidator-membership.providers';
import { createProfitReadCacheInvalidatorRegistry } from './cache-invalidator-profit-read.providers';
import { createPulseCacheInvalidatorRegistry } from './cache-invalidator-pulse.providers';
import {
  buildBusinessAnalysisPattern,
  buildMembersListPattern,
  buildMarketingOverviewCacheKey,
  buildProfitDashboardHomePattern,
} from './cache-keys';
import {
  buildFinanceAccountsPattern,
  buildFinanceOverviewPattern,
} from '../purely-profit/finance/finance.cache-keys';
import {
  buildPulseDashboardHomePattern,
  buildPulseDashboardOverviewPattern,
  buildPulseSessionNotificationCacheKey,
} from '../purely-pulse/pulse.cache-keys';

type RedisServiceMock = {
  del: jest.Mock<Promise<void>, [string]>;
  delByPattern: jest.Mock<Promise<void>, [string]>;
};

function createRedisServiceMock(): RedisServiceMock {
  return {
    del: jest.fn((_key: string) => Promise.resolve()),
    delByPattern: jest.fn((_pattern: string) => Promise.resolve()),
  };
}

describe('cache invalidator registries', () => {
  it('profitRead registry 会组装所有商家读侧 invalidator', async () => {
    const redisService = createRedisServiceMock();
    const registry = createProfitReadCacheInvalidatorRegistry({ redisService });

    expect(Object.keys(registry).sort()).toEqual([
      'invalidateBusinessAnalysis',
      'invalidateMarketingOverview',
      'invalidateProfitDashboardHome',
      'invalidateSalesReadCaches',
    ]);

    await registry.invalidateProfitDashboardHome(18);
    await registry.invalidateBusinessAnalysis(18);
    await registry.invalidateMarketingOverview(18);

    expect(redisService.delByPattern).toHaveBeenCalledWith(
      buildProfitDashboardHomePattern(18),
    );
    expect(redisService.delByPattern).toHaveBeenCalledWith(
      buildBusinessAnalysisPattern(18),
    );
    expect(redisService.del).toHaveBeenCalledWith(
      buildMarketingOverviewCacheKey(18),
    );
  });

  it('membership registry 会组装会员域 invalidator', async () => {
    const redisService = createRedisServiceMock();
    const registry = createMembershipCacheInvalidatorRegistry({ redisService });

    expect(Object.keys(registry).sort()).toEqual([
      'invalidateMembersDerived',
      'invalidatePlatformMembershipDerived',
      'invalidateWithdrawalsDerived',
    ]);

    await registry.invalidateMembersDerived(18);

    expect(redisService.delByPattern).toHaveBeenCalledWith(
      buildMembersListPattern(18),
    );
  });

  it('finance registry 会组装财务域 invalidator', async () => {
    const redisService = createRedisServiceMock();
    const registry = createFinanceCacheInvalidatorRegistry({ redisService });

    expect(Object.keys(registry).sort()).toEqual([
      'invalidateFinanceAccounts',
      'invalidateFinanceCashFlow',
      'invalidateFinanceOverview',
      'invalidateFinanceReconciliations',
    ]);

    await registry.invalidateFinanceOverview(18);
    await registry.invalidateFinanceAccounts(18);

    expect(redisService.delByPattern).toHaveBeenCalledWith(
      buildFinanceOverviewPattern(18),
    );
    expect(redisService.delByPattern).toHaveBeenCalledWith(
      buildFinanceAccountsPattern(18),
    );
  });

  it('pulse registry 会组装 pulse 域 invalidator', async () => {
    const redisService = createRedisServiceMock();
    const registry = createPulseCacheInvalidatorRegistry({ redisService });

    expect(Object.keys(registry).sort()).toEqual([
      'invalidatePulseDashboardHome',
      'invalidatePulseDashboardOverview',
      'invalidatePulseDashboardRevenueDetail',
      'invalidatePulseGrowthAdminQueries',
      'invalidatePulseGrowthEarnings',
      'invalidatePulseOnboardingStatus',
      'invalidatePulseOnboardingStatusByUser',
      'invalidatePulseSessionBootstrap',
      'invalidatePulseSessionBootstrapByUser',
      'invalidatePulseSessionNotification',
    ]);

    await registry.invalidatePulseDashboardHome();
    await registry.invalidatePulseDashboardOverview(18);
    await registry.invalidatePulseSessionNotification(18);

    expect(redisService.delByPattern).toHaveBeenCalledWith(
      buildPulseDashboardHomePattern(),
    );
    expect(redisService.delByPattern).toHaveBeenCalledWith(
      buildPulseDashboardOverviewPattern(18),
    );
    expect(redisService.del).toHaveBeenCalledWith(
      buildPulseSessionNotificationCacheKey(18),
    );
  });
});
