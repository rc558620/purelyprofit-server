import {
  buildMembersMetaAllPattern,
  parseMembersMetaCacheKey,
} from './cache-keys';
import type {
  CachePrewarmProfitReadCategoryConfigProvider,
  CachePrewarmProfitReadConfigInput,
} from './cache-prewarm.config.types';
import { prewarmCacheCategory } from './cache-prewarm.executor';
import type { CachePrewarmExecutionOptions } from './cache-prewarm.types';

export const membersMetaCachePrewarmProvider: CachePrewarmProfitReadCategoryConfigProvider =
  (input: CachePrewarmProfitReadConfigInput) => ({
    category: 'membersMeta',
    scanPattern: buildMembersMetaAllPattern,
    prewarm: (cacheKeys, options: CachePrewarmExecutionOptions) =>
      prewarmCacheCategory(
        'membersMeta',
        cacheKeys,
        parseMembersMetaCacheKey,
        (parsed) => input.membersService.warmMetaCache(parsed.storeId),
        options,
      ),
  });
