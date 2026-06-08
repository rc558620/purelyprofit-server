/**
 * 缓存预热统一入口
 *
 * 本文件作为 cache-prewarm 相关能力的对外导出桶，
 * 将分散在 src/redis 根目录的 prewarm 实现收敛到统一命名空间。
 */

// 预热主服务与周期调度
export { CachePrewarmService } from '../cache-prewarm.service';
export { CachePrewarmCycleService } from '../cache-prewarm-cycle.service';

// 预热执行器
export { prewarmCacheCategory } from '../cache-prewarm.executor';

// 配置与类型
export { buildCachePrewarmCategoryConfigs } from '../cache-prewarm.config';

export type {
  CachePrewarmCategoryConfigProvider,
  CachePrewarmFinanceCategoryConfigProvider,
} from '../cache-prewarm.config.types';

// Provider 集合
export { cachePrewarmCategoryConfigProviders } from '../cache-prewarm.providers';

// 领域预热 Provider（按域）
export { financeOverviewCachePrewarmProvider } from '../cache-prewarm-finance-overview.provider';
export { businessAnalysisCachePrewarmProvider } from '../cache-prewarm-business-analysis.provider';
export { profitDashboardHomeCachePrewarmProvider } from '../cache-prewarm-profit-dashboard-home.provider';

// 工具函数
export {
  buildCachePrewarmDurationDistribution,
  buildEmptyCachePrewarmCategoryResult,
  selectTopSlowCachePrewarmSamples,
  buildCachePrewarmCategoryResultsMap,
  buildCachePrewarmCycleMetrics,
} from '../cache-prewarm.utils';

// 常量与类型
export {
  CACHE_PREWARM_CATEGORIES,
  type CachePrewarmCategory,
  type CachePrewarmDurationDistribution,
  type CachePrewarmSlowKeySample,
  type CachePrewarmCategoryResult,
  type CachePrewarmCategoryResultsMap,
  type CachePrewarmCategoryCountMap,
  type CachePrewarmDurationDistributionMap,
  type CachePrewarmCycleMetrics,
  type CachePrewarmExecutionOptions,
} from '../cache-prewarm.types';
