import {
  buildBusinessAnalysisPattern,
  buildMarketingOverviewCacheKey,
  buildMembersListPattern,
  buildMembersMetaCacheKey,
  buildMembersOverviewCacheKey,
  buildPlatformMembershipDerivedPattern,
  buildProfitDashboardHomeChunkPattern,
  buildProfitDashboardHomePattern,
  buildSalesReportPattern,
  buildSalesStatsPattern,
  buildWithdrawalsListPattern,
  buildWithdrawalsOverviewCacheKey,
} from './cache-keys';
import { businessAnalysisCacheInvalidatorProvider } from './cache-invalidator-business-analysis.provider';
import { financeAccountsCacheInvalidatorProvider } from './cache-invalidator-finance-accounts.provider';
import { financeCashFlowCacheInvalidatorProvider } from './cache-invalidator-finance-cash-flow.provider';
import { financeOverviewCacheInvalidatorProvider } from './cache-invalidator-finance-overview.provider';
import { financeReconciliationsCacheInvalidatorProvider } from './cache-invalidator-finance-reconciliations.provider';
import { marketingOverviewCacheInvalidatorProvider } from './cache-invalidator-marketing-overview.provider';
import { membersCacheInvalidatorProvider } from './cache-invalidator-members.provider';
import { platformMembershipDerivedCacheInvalidatorProvider } from './cache-invalidator-platform-membership-derived.provider';
import { profitDashboardHomeCacheInvalidatorProvider } from './cache-invalidator-profit-dashboard-home.provider';
import { pulseDashboardHomeCacheInvalidatorProvider } from './cache-invalidator-pulse-dashboard-home.provider';
import { pulseDashboardOverviewCacheInvalidatorProvider } from './cache-invalidator-pulse-dashboard-overview.provider';
import { pulseDashboardRevenueDetailCacheInvalidatorProvider } from './cache-invalidator-pulse-dashboard-revenue-detail.provider';
import { pulseGrowthAdminCacheInvalidatorProvider } from './cache-invalidator-pulse-growth-admin.provider';
import { pulseGrowthEarningsCacheInvalidatorProvider } from './cache-invalidator-pulse-growth-earnings.provider';
import { pulseOnboardingStatusByUserCacheInvalidatorProvider } from './cache-invalidator-pulse-onboarding-status-user.provider';
import { pulseOnboardingStatusCacheInvalidatorProvider } from './cache-invalidator-pulse-onboarding-status.provider';
import { pulseSessionBootstrapByUserCacheInvalidatorProvider } from './cache-invalidator-pulse-session-bootstrap-user.provider';
import { pulseSessionBootstrapCacheInvalidatorProvider } from './cache-invalidator-pulse-session-bootstrap.provider';
import { pulseSessionNotificationCacheInvalidatorProvider } from './cache-invalidator-pulse-session-notification.provider';
import { salesReadCacheInvalidatorProvider } from './cache-invalidator-sales-read.provider';
import { withdrawalsCacheInvalidatorProvider } from './cache-invalidator-withdrawals.provider';
import {
  buildFinanceAccountsPattern,
  buildFinanceCashFlowPattern,
  buildFinanceOverviewPattern,
  buildFinanceReconciliationsPattern,
} from '../purely-profit/finance/finance.cache-keys';
import {
  buildPulseDashboardHomePattern,
  buildPulseDashboardOverviewPattern,
  buildPulseDashboardRevenueDetailPattern,
  buildPulseDashboardStoresPattern,
  buildPulseGrowthAdminPattern,
  buildPulseGrowthEarningsPatterns,
  buildPulseOnboardingStatusPatternByStore,
  buildPulseOnboardingStatusPatternByUser,
  buildPulseSessionBootstrapPatternByStore,
  buildPulseSessionBootstrapPatternByUser,
  buildPulseSessionNotificationCacheKey,
} from '../purely-pulse/pulse.cache-keys';

type RedisServiceMock = {
  del: jest.Mock<Promise<void>, [string]>;
  delByPattern: jest.Mock<Promise<number>, [string]>;
};

type ProviderCase = {
  description: string;
  invoke: (redisService: RedisServiceMock) => Promise<void>;
  expectedDelCalls?: string[];
  expectedDelByPatternCalls?: string[];
};

function createRedisServiceMock(): RedisServiceMock {
  return {
    del: jest.fn((_key: string) => {
      void _key;
      return Promise.resolve();
    }),
    delByPattern: jest.fn((_pattern: string) => {
      void _pattern;
      return Promise.resolve(1);
    }),
  };
}

const providerCases: readonly ProviderCase[] = [
  {
    description: 'profitDashboardHome provider 会清理首页与分块缓存',
    invoke: (redisService) =>
      profitDashboardHomeCacheInvalidatorProvider({
        redisService,
      }).invalidateProfitDashboardHome(18),
    expectedDelByPatternCalls: [
      buildProfitDashboardHomePattern(18),
      buildProfitDashboardHomeChunkPattern(18),
    ],
  },
  {
    description: 'businessAnalysis provider 会按门店清理经营分析缓存',
    invoke: (redisService) =>
      businessAnalysisCacheInvalidatorProvider({
        redisService,
      }).invalidateBusinessAnalysis(18),
    expectedDelByPatternCalls: [buildBusinessAnalysisPattern(18)],
  },
  {
    description: 'marketingOverview provider 会清理营销总览缓存',
    invoke: (redisService) =>
      marketingOverviewCacheInvalidatorProvider({
        redisService,
      }).invalidateMarketingOverview(18),
    expectedDelCalls: [buildMarketingOverviewCacheKey(18)],
  },
  {
    description: 'salesRead provider 会清理销售统计与报表缓存',
    invoke: (redisService) =>
      salesReadCacheInvalidatorProvider({
        redisService,
      }).invalidateSalesReadCaches(18),
    expectedDelByPatternCalls: [
      buildSalesStatsPattern(18),
      buildSalesReportPattern(18),
    ],
  },
  {
    description: 'members provider 会同时清理列表与聚合缓存',
    invoke: (redisService) =>
      membersCacheInvalidatorProvider({
        redisService,
      }).invalidateMembersDerived(18),
    expectedDelCalls: [
      buildMembersMetaCacheKey(18),
      buildMembersOverviewCacheKey(18),
    ],
    expectedDelByPatternCalls: [buildMembersListPattern(18)],
  },
  {
    description: 'withdrawals provider 会清理提现概览与列表缓存',
    invoke: (redisService) =>
      withdrawalsCacheInvalidatorProvider({
        redisService,
      }).invalidateWithdrawalsDerived(18),
    expectedDelCalls: [buildWithdrawalsOverviewCacheKey(18)],
    expectedDelByPatternCalls: [buildWithdrawalsListPattern(18)],
  },
  {
    description: 'platformMembershipDerived provider 会清理平台会员派生缓存',
    invoke: (redisService) =>
      platformMembershipDerivedCacheInvalidatorProvider({
        redisService,
      }).invalidatePlatformMembershipDerived(18),
    expectedDelByPatternCalls: [buildPlatformMembershipDerivedPattern(18)],
  },
  {
    description: 'financeOverview provider 会清理财务概览缓存',
    invoke: (redisService) =>
      financeOverviewCacheInvalidatorProvider({
        redisService,
      }).invalidateFinanceOverview(18),
    expectedDelByPatternCalls: [buildFinanceOverviewPattern(18)],
  },
  {
    description: 'financeCashFlow provider 会清理现金流缓存',
    invoke: (redisService) =>
      financeCashFlowCacheInvalidatorProvider({
        redisService,
      }).invalidateFinanceCashFlow(18),
    expectedDelByPatternCalls: [buildFinanceCashFlowPattern(18)],
  },
  {
    description: 'financeAccounts provider 会清理账户列表缓存',
    invoke: (redisService) =>
      financeAccountsCacheInvalidatorProvider({
        redisService,
      }).invalidateFinanceAccounts(18),
    expectedDelByPatternCalls: [buildFinanceAccountsPattern(18)],
  },
  {
    description: 'financeReconciliations provider 会清理对账缓存',
    invoke: (redisService) =>
      financeReconciliationsCacheInvalidatorProvider({
        redisService,
      }).invalidateFinanceReconciliations(18),
    expectedDelByPatternCalls: [buildFinanceReconciliationsPattern(18)],
  },
  {
    description: 'pulseDashboardHome provider 会清理 pulse 首页缓存',
    invoke: (redisService) =>
      pulseDashboardHomeCacheInvalidatorProvider({
        redisService,
      }).invalidatePulseDashboardHome(),
    expectedDelByPatternCalls: [buildPulseDashboardHomePattern()],
  },
  {
    description:
      'pulseDashboardRevenueDetail provider 会清理 pulse 收益明细缓存',
    invoke: (redisService) =>
      pulseDashboardRevenueDetailCacheInvalidatorProvider({
        redisService,
      }).invalidatePulseDashboardRevenueDetail(),
    expectedDelByPatternCalls: [buildPulseDashboardRevenueDetailPattern()],
  },
  {
    description: 'pulseDashboardOverview provider 会按门店清理 pulse 总览缓存',
    invoke: (redisService) =>
      pulseDashboardOverviewCacheInvalidatorProvider({
        redisService,
      }).invalidatePulseDashboardOverview(18),
    expectedDelByPatternCalls: [
      buildPulseDashboardOverviewPattern(18),
      buildPulseDashboardStoresPattern(18),
    ],
  },
  {
    description: 'pulseGrowthAdmin provider 会清理 pulse 管理查询缓存',
    invoke: (redisService) =>
      pulseGrowthAdminCacheInvalidatorProvider({
        redisService,
      }).invalidatePulseGrowthAdminQueries(),
    expectedDelByPatternCalls: [buildPulseGrowthAdminPattern()],
  },
  {
    description: 'pulseGrowthEarnings provider 会清理 pulse 收益缓存',
    invoke: (redisService) =>
      pulseGrowthEarningsCacheInvalidatorProvider({
        redisService,
      }).invalidatePulseGrowthEarnings(18),
    expectedDelByPatternCalls: [...buildPulseGrowthEarningsPatterns(18)],
  },
  {
    description: 'pulseSessionNotification provider 会清理 pulse 通知缓存',
    invoke: (redisService) =>
      pulseSessionNotificationCacheInvalidatorProvider({
        redisService,
      }).invalidatePulseSessionNotification(18),
    expectedDelCalls: [buildPulseSessionNotificationCacheKey(18)],
  },
  {
    description:
      'pulseSessionBootstrap provider 会按门店清理 pulse bootstrap 缓存',
    invoke: (redisService) =>
      pulseSessionBootstrapCacheInvalidatorProvider({
        redisService,
      }).invalidatePulseSessionBootstrap(18),
    expectedDelByPatternCalls: [buildPulseSessionBootstrapPatternByStore(18)],
  },
  {
    description:
      'pulseSessionBootstrapByUser provider 会按用户清理 pulse bootstrap 缓存',
    invoke: (redisService) =>
      pulseSessionBootstrapByUserCacheInvalidatorProvider({
        redisService,
      }).invalidatePulseSessionBootstrapByUser(9),
    expectedDelByPatternCalls: [buildPulseSessionBootstrapPatternByUser(9)],
  },
  {
    description: 'pulseOnboardingStatus provider 会按门店清理 onboarding 缓存',
    invoke: (redisService) =>
      pulseOnboardingStatusCacheInvalidatorProvider({
        redisService,
      }).invalidatePulseOnboardingStatus(18),
    expectedDelByPatternCalls: [buildPulseOnboardingStatusPatternByStore(18)],
  },
  {
    description:
      'pulseOnboardingStatusByUser provider 会按用户清理 onboarding 缓存',
    invoke: (redisService) =>
      pulseOnboardingStatusByUserCacheInvalidatorProvider({
        redisService,
      }).invalidatePulseOnboardingStatusByUser(9),
    expectedDelByPatternCalls: [buildPulseOnboardingStatusPatternByUser(9)],
  },
];

describe('cache invalidator providers', () => {
  it.each(providerCases)(
    '$description',
    async ({ invoke, expectedDelCalls, expectedDelByPatternCalls }) => {
      const redisService = createRedisServiceMock();

      await invoke(redisService);

      expect(redisService.del.mock.calls.map(([key]) => key)).toEqual(
        expectedDelCalls ?? [],
      );
      expect(
        redisService.delByPattern.mock.calls.map(([pattern]) => pattern),
      ).toEqual(expectedDelByPatternCalls ?? []);
    },
  );
});
