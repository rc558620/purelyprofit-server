import {
  buildBusinessAnalysisAllPattern,
  buildCostsAllPattern,
  buildMarketingOverviewAllPattern,
  buildMembersMetaAllPattern,
  buildMembersOverviewAllPattern,
  buildProfitDashboardHomeAllPattern,
  buildProfitDetailAllPattern,
  buildProfitReportAllPattern,
} from './cache-keys';
import {
  buildCachePrewarmCategoryConfigs,
  createCachePrewarmCategoryConfigs,
} from './cache-prewarm.config';
import {
  buildFinanceOverviewAllPattern,
  buildFinanceReportAllPattern,
} from '../purely-profit/finance/finance.cache-keys';

function createEmptyPrewarmResult() {
  return Promise.resolve({
    hitCount: 0,
    refreshedCount: 0,
    skippedCount: 0,
    invalidCount: 0,
    failedCount: 0,
    durationDistribution: {
      sampleCount: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      minDurationMs: 0,
      maxDurationMs: 0,
      p50DurationMs: 0,
      p95DurationMs: 0,
    },
    slowKeySamples: [],
  });
}

describe('cache prewarm config', () => {
  it('buildCachePrewarmCategoryConfigs 会按 provider 顺序构建配置', () => {
    const firstProvider = jest.fn((input: { storeId: number }) => ({
      category: 'dashboardHome' as const,
      scanPattern: () => `dashboard:${input.storeId}`,
      prewarm: jest.fn(() => createEmptyPrewarmResult()),
    })) as never;
    const secondProvider = jest.fn((input: { storeId: number }) => ({
      category: 'businessAnalysis' as const,
      scanPattern: () => `analysis:${input.storeId}`,
      prewarm: jest.fn(() => createEmptyPrewarmResult()),
    })) as never;

    const configs = buildCachePrewarmCategoryConfigs(
      [firstProvider, secondProvider],
      { storeId: 18 },
    );

    expect(firstProvider).toHaveBeenCalledWith({ storeId: 18 });
    expect(secondProvider).toHaveBeenCalledWith({ storeId: 18 });
    expect(configs.map((config) => config.scanPattern())).toEqual([
      'dashboard:18',
      'analysis:18',
    ]);
  });

  it('createCachePrewarmCategoryConfigs 会按域顺序组装所有 prewarm 配置', () => {
    const configs = createCachePrewarmCategoryConfigs({
      dashboardHomeService: {
        warmOverviewCache: jest.fn(() => Promise.resolve()) as never,
      },
      businessAnalysisService: {
        warmAnalysisCache: jest.fn(() => Promise.resolve()) as never,
      },
      financeOverviewService: {
        warmOverviewCache: jest.fn(() => Promise.resolve()) as never,
        warmReportCache: jest.fn(() => Promise.resolve()) as never,
      },
      marketingOverviewService: {
        warmOverviewCache: jest.fn(() => Promise.resolve()) as never,
      },
      membersService: {
        warmMetaCache: jest.fn(() => Promise.resolve()) as never,
        warmOverviewCache: jest.fn(() => Promise.resolve()) as never,
      },
      profitDetailService: {
        warmDetailCache: jest.fn(() => Promise.resolve()) as never,
        warmReportCache: jest.fn(() => Promise.resolve()) as never,
      },
      costsReadService: {
        warmStatsCache: jest.fn(() => Promise.resolve()) as never,
        warmReportCache: jest.fn(() => Promise.resolve()) as never,
      },
    });

    expect(configs.map((config) => config.category)).toEqual([
      'dashboardHome',
      'businessAnalysis',
      'marketingOverview',
      'membersMeta',
      'membersOverview',
      'profitDetail',
      'profitReport',
      'costsStats',
      'costsReport',
      'financeOverview',
      'financeReport',
    ]);
    expect(configs.map((config) => config.scanPattern())).toEqual([
      buildProfitDashboardHomeAllPattern(),
      buildBusinessAnalysisAllPattern(),
      buildMarketingOverviewAllPattern(),
      buildMembersMetaAllPattern(),
      buildMembersOverviewAllPattern(),
      buildProfitDetailAllPattern(),
      buildProfitReportAllPattern(),
      buildCostsAllPattern(),
      buildCostsAllPattern(),
      buildFinanceOverviewAllPattern(),
      buildFinanceReportAllPattern(),
    ]);
  });
});
