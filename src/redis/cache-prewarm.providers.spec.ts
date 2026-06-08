import {
  buildBusinessAnalysisCacheKey,
  buildProfitDashboardHomeCacheKey,
} from './cache-keys';
import { businessAnalysisCachePrewarmProvider } from './cache-prewarm-business-analysis.provider';
import { financeOverviewCachePrewarmProvider } from './cache-prewarm-finance-overview.provider';
import { profitDashboardHomeCachePrewarmProvider } from './cache-prewarm-profit-dashboard-home.provider';
import { buildFinanceOverviewCacheKey } from '../purely-profit/finance/finance.cache-keys';

describe('cache prewarm providers', () => {
  it('profitDashboardHome provider 会直接预热首页缓存', async () => {
    const dashboardHomeService = {
      warmOverviewCache: jest.fn(() => Promise.resolve()),
    };
    const provider = profitDashboardHomeCachePrewarmProvider({
      dashboardHomeService,
      businessAnalysisService: {
        warmAnalysisCache: jest.fn(() => Promise.resolve()),
      },
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
      dashboardHomeService: {
        warmOverviewCache: jest.fn(() => Promise.resolve()),
      },
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

  it('financeOverview provider 会直接预热财务概览缓存', async () => {
    const financeOverviewService = {
      warmOverviewCache: jest.fn(() => Promise.resolve()),
    };
    const provider = financeOverviewCachePrewarmProvider({
      financeOverviewService,
    });

    const result = await provider.prewarm(
      [buildFinanceOverviewCacheKey(18, 'month')],
      { concurrency: 1 },
    );

    expect(provider.category).toBe('financeOverview');
    expect(financeOverviewService.warmOverviewCache).toHaveBeenCalledWith(
      18,
      'month',
    );
    expect(result.hitCount).toBe(1);
    expect(result.refreshedCount).toBe(1);
    expect(result.invalidCount).toBe(0);
  });
});
