import {
  buildBusinessAnalysisCacheKey,
  buildMarketingOverviewCacheKey,
  buildMembersMetaCacheKey,
  buildMembersOverviewCacheKey,
  buildProfitDashboardHomeCacheKey,
} from './cache-keys';
import { businessAnalysisCachePrewarmProvider } from './cache-prewarm-business-analysis.provider';
import { financeOverviewCachePrewarmProvider } from './cache-prewarm-finance-overview.provider';
import { marketingOverviewCachePrewarmProvider } from './cache-prewarm-marketing-overview.provider';
import { membersMetaCachePrewarmProvider } from './cache-prewarm-members-meta.provider';
import { membersOverviewCachePrewarmProvider } from './cache-prewarm-members-overview.provider';
import { profitDashboardHomeCachePrewarmProvider } from './cache-prewarm-profit-dashboard-home.provider';
import { buildFinanceOverviewCacheKey } from '../purely-profit/finance/finance.cache-keys';

describe('cache prewarm providers', () => {
  const createProfitReadInput = () => ({
    dashboardHomeService: {
      warmOverviewCache: jest.fn(() => Promise.resolve()),
    },
    businessAnalysisService: {
      warmAnalysisCache: jest.fn(() => Promise.resolve()),
    },
    marketingOverviewService: {
      warmOverviewCache: jest.fn(() => Promise.resolve()),
    },
    membersService: {
      warmMetaCache: jest.fn(() => Promise.resolve()),
      warmOverviewCache: jest.fn(() => Promise.resolve()),
    },
  });

  it('profitDashboardHome provider 会直接预热首页缓存', async () => {
    const dashboardHomeService = {
      warmOverviewCache: jest.fn(() => Promise.resolve()),
    };
    const provider = profitDashboardHomeCachePrewarmProvider({
      ...createProfitReadInput(),
      dashboardHomeService,
    });

    const result = await provider.prewarm(
      [buildProfitDashboardHomeCacheKey(18, 'today'), 'invalid:key'],
      { concurrency: 2 },
    );

    expect(provider.category).toBe('dashboardHome');
    expect(dashboardHomeService.warmOverviewCache).toHaveBeenCalledWith(
      18,
      'today',
    );
    expect(result.hitCount).toBe(2);
    expect(result.refreshedCount).toBe(1);
    expect(result.invalidCount).toBe(1);
  });

  it('businessAnalysis provider 会直接预热经营分析缓存', async () => {
    const businessAnalysisService = {
      warmAnalysisCache: jest.fn(() => Promise.resolve()),
    };
    const provider = businessAnalysisCachePrewarmProvider({
      ...createProfitReadInput(),
      businessAnalysisService,
    });

    const result = await provider.prewarm(
      [
        buildBusinessAnalysisCacheKey(18, {
          period: 'month',
          startTime: undefined,
          endTime: undefined,
        }),
      ],
      { concurrency: 1 },
    );

    expect(provider.category).toBe('businessAnalysis');
    expect(businessAnalysisService.warmAnalysisCache).toHaveBeenCalledWith(18, {
      period: 'month',
      startTime: undefined,
      endTime: undefined,
    });
    expect(result.hitCount).toBe(1);
    expect(result.refreshedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('marketingOverview provider 会直接预热营销概览缓存', async () => {
    const marketingOverviewService = {
      warmOverviewCache: jest.fn(() => Promise.resolve()),
    };
    const provider = marketingOverviewCachePrewarmProvider({
      ...createProfitReadInput(),
      marketingOverviewService,
    });

    const result = await provider.prewarm(
      [buildMarketingOverviewCacheKey(18)],
      { concurrency: 1 },
    );

    expect(provider.category).toBe('marketingOverview');
    expect(marketingOverviewService.warmOverviewCache).toHaveBeenCalledWith(18);
    expect(result.hitCount).toBe(1);
    expect(result.refreshedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('membersMeta provider 会直接预热会员筛选缓存', async () => {
    const membersService = {
      warmMetaCache: jest.fn(() => Promise.resolve()),
      warmOverviewCache: jest.fn(() => Promise.resolve()),
    };
    const provider = membersMetaCachePrewarmProvider({
      ...createProfitReadInput(),
      membersService,
    });

    const result = await provider.prewarm([buildMembersMetaCacheKey(18)], {
      concurrency: 1,
    });

    expect(provider.category).toBe('membersMeta');
    expect(membersService.warmMetaCache).toHaveBeenCalledWith(18);
    expect(result.hitCount).toBe(1);
    expect(result.refreshedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('membersOverview provider 会直接预热会员概览缓存', async () => {
    const membersService = {
      warmMetaCache: jest.fn(() => Promise.resolve()),
      warmOverviewCache: jest.fn(() => Promise.resolve()),
    };
    const provider = membersOverviewCachePrewarmProvider({
      ...createProfitReadInput(),
      membersService,
    });

    const result = await provider.prewarm([buildMembersOverviewCacheKey(18)], {
      concurrency: 1,
    });

    expect(provider.category).toBe('membersOverview');
    expect(membersService.warmOverviewCache).toHaveBeenCalledWith(18);
    expect(result.hitCount).toBe(1);
    expect(result.refreshedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('financeOverview provider 会直接预热财务概览缓存', async () => {
    const financeOverviewService = {
      warmOverviewCache: jest.fn(() => Promise.resolve()),
    };
    const provider = financeOverviewCachePrewarmProvider({
      financeOverviewService,
    });

    const result = await provider.prewarm(
      [buildFinanceOverviewCacheKey(18, 'month', 'owner')],
      { concurrency: 1 },
    );

    expect(provider.category).toBe('financeOverview');
    expect(financeOverviewService.warmOverviewCache).toHaveBeenCalledWith(
      18,
      'month',
      'owner',
    );
    expect(result.hitCount).toBe(1);
    expect(result.refreshedCount).toBe(1);
    expect(result.invalidCount).toBe(0);
  });
});
