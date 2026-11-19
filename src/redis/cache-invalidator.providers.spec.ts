import {
  buildBusinessAnalysisPattern,
  buildClubCheckInPromotionCacheKey,
  buildClubPromotionsCacheKey,
  buildClubPromotionListCacheKey,
  buildClubRechargePackagesCacheKey,
  buildProfitDashboardHomeActivitiesLivePattern,
  buildProfitDashboardHomeActivitiesStablePattern,
  buildMarketingOverviewCacheKey,
  buildMembersListPattern,
  buildMembersMetaCacheKey,
  buildMembersOverviewCacheKey,
  buildMembersSnapshotsPattern,
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
  buildFinanceAccountsStatsCacheKey,
  buildFinanceCashFlowPattern,
  buildFinanceOverviewPattern,
  buildFinanceReconciliationsPattern,
  buildFinanceReconciliationsStatsCacheKey,
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
  delByPatterns: jest.Mock<Promise<number>, [string[]]>;
};

type ProviderCase = {
  description: string;
  invoke: (redisService: RedisServiceMock) => Promise<void>;
  expectedDelCalls?: string[];
  expectedDelByPatternCalls?: string[];
  expectedDelByPatternsCalls?: string[][];
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
    delByPatterns: jest.fn((_patterns: string[]) => {
      void _patterns;
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
    // 动态块键里带业务日，无法用固定键精确删除，改为按前缀模式清理
    expectedDelByPatternsCalls: [
      [
        buildProfitDashboardHomePattern(18),
        buildProfitDashboardHomeChunkPattern(18),
        buildProfitDashboardHomeActivitiesLivePattern(18),
        buildProfitDashboardHomeActivitiesStablePattern(18),
      ],
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
    // C 端两份活动缓存（定价投影 + 展示列表）必须成对失效；
    // 充值套餐同样投影自 marketing_promotions（type=recharge_gift），一并清理；
    // 签到活动配置同为 marketing_promotions 投影（type=daily_check_in）
    expectedDelCalls: [
      buildMarketingOverviewCacheKey(18),
      buildClubPromotionsCacheKey(18),
      buildClubPromotionListCacheKey(18),
      buildClubRechargePackagesCacheKey(18),
      buildClubCheckInPromotionCacheKey(18),
    ],
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
    description: 'members provider 会同时清理列表、快照与聚合缓存',
    invoke: (redisService) =>
      membersCacheInvalidatorProvider({
        redisService,
      }).invalidateMembersDerived(18),
    expectedDelCalls: [
      buildMembersMetaCacheKey(18),
      buildMembersOverviewCacheKey(18),
    ],
    expectedDelByPatternsCalls: [
      [buildMembersListPattern(18), buildMembersSnapshotsPattern(18)],
    ],
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
    description: 'financeAccounts provider 会清理账户列表与统计缓存',
    invoke: (redisService) =>
      financeAccountsCacheInvalidatorProvider({
        redisService,
      }).invalidateFinanceAccounts(18),
    expectedDelCalls: [buildFinanceAccountsStatsCacheKey(18)],
    expectedDelByPatternCalls: [buildFinanceAccountsPattern(18)],
  },
  {
    description: 'financeReconciliations provider 会清理对账列表与统计缓存',
    invoke: (redisService) =>
      financeReconciliationsCacheInvalidatorProvider({
        redisService,
      }).invalidateFinanceReconciliations(18),
    expectedDelCalls: [buildFinanceReconciliationsStatsCacheKey(18)],
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
    async ({
      invoke,
      expectedDelCalls,
      expectedDelByPatternCalls,
      expectedDelByPatternsCalls,
    }) => {
      const redisService = createRedisServiceMock();

      await invoke(redisService);

      expect(redisService.del.mock.calls.map(([key]) => key)).toEqual(
        expectedDelCalls ?? [],
      );
      expect(
        redisService.delByPattern.mock.calls.map(([pattern]) => pattern),
      ).toEqual(expectedDelByPatternCalls ?? []);
      expect(
        redisService.delByPatterns.mock.calls.map(([patterns]) => patterns),
      ).toEqual(expectedDelByPatternsCalls ?? []);
    },
  );

  it('财务门店缓存 pattern 以 store:<id>: 收口，不会误清同前缀门店', () => {
    // 早期写法 store:18* 会把 store:180 一起清掉
    expect(buildFinanceAccountsPattern(18)).toBe(
      'profit:finance:accounts:*:store:18:*',
    );
    expect(buildFinanceReconciliationsPattern(18)).toBe(
      'profit:finance:reconciliations:*:store:18:*',
    );
  });
});
