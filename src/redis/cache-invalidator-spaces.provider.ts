import {
  buildSpacesDashboardPattern,
  buildSpacesListPattern,
} from './keys/spaces.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

/**
 * 空间管理读侧缓存失效（看板 + 列表）。
 *
 * 触发点：开台 / 结账 / 续费 / 换房 / 追加商品 / 标记可用 / 预约变更 /
 * 空间增删改 —— 任何影响空间运行态或看板统计的写路径。
 */
export const spacesReadCacheInvalidatorProvider: CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Pick<ProfitReadCacheInvalidatorRegistry, 'invalidateSpacesReadCaches'>
> = (input) => ({
  invalidateSpacesReadCaches: async (storeId: number): Promise<void> => {
    await Promise.all([
      input.redisService.delByPattern(buildSpacesDashboardPattern(storeId)),
      input.redisService.delByPattern(buildSpacesListPattern(storeId)),
    ]);
  },
});
