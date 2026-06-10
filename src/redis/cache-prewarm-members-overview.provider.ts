import {
  buildMembersOverviewAllPattern,
  parseMembersOverviewCacheKey,
} from './cache-keys';
import type {
  CachePrewarmProfitReadCategoryConfigProvider,
  CachePrewarmProfitReadConfigInput,
} from './cache-prewarm.config.types';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';

export const membersOverviewCachePrewarmProvider: CachePrewarmProfitReadCategoryConfigProvider =
  (input: CachePrewarmProfitReadConfigInput) => ({
    category: 'membersOverview',
    scanPattern: buildMembersOverviewAllPattern,
    prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
      prewarmCacheCategory(
        'membersOverview',
        cacheKeys,
        parseMembersOverviewCacheKey,
        (parsed) => input.membersService.warmOverviewCache(parsed.storeId),
        options,
      ),
  });
