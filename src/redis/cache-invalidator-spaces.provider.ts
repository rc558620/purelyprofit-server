import {
  buildSpaceLivePreviewPattern,
  buildSpacesDashboardPattern,
  buildSpacesDashboardStatsCacheKey,
  buildSpacesListPattern,
  buildSpaceQrImagePattern,
  buildSpaceSessionsSnapshotPattern,
} from './keys/spaces.cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

/**
 * 空间管理读侧缓存失效（看板 + 列表 + 门店会话快照 + 实时预览 + 二维码图片产物）。
 *
 * 触发点：开台 / 结账 / 续费 / 换房 / 追加商品 / 标记可用 / 预约变更 /
 * 空间增删改 —— 任何影响空间运行态、会话明细或看板统计的写路径。
 *
 * 实时预览键带 `store:{storeId}` 段，因此只能按门店整片失效：写路径无法
 * 预知目标会话当前落在哪个 elapsed 桶，按桶精确删会漏键。
 *
 * 二维码图片缓存按空间维度单独失效：轮换会改变 tokenHash 从而自然换键，
 * 空间删除后旧键不会再被命中，但需要主动清理，避免图片产物滞留到 TTL。
 */
export const spacesReadCacheInvalidatorProvider: CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Pick<
    ProfitReadCacheInvalidatorRegistry,
    'invalidateSpacesReadCaches' | 'invalidateSpaceQrImageCache'
  >
> = (input) => ({
  invalidateSpacesReadCaches: async (storeId: number): Promise<void> => {
    await Promise.all([
      input.redisService.delByPattern(buildSpacesDashboardPattern(storeId)),
      // 统计轻量缓存独立分键，需与主看板一起失效（精确 del，不用通配避免误删邻近门店）
      input.redisService.del(buildSpacesDashboardStatsCacheKey(storeId)),
      input.redisService.delByPattern(buildSpacesListPattern(storeId)),
      input.redisService.delByPattern(
        buildSpaceSessionsSnapshotPattern(storeId),
      ),
      input.redisService.delByPattern(buildSpaceLivePreviewPattern(storeId)),
    ]);
  },
  invalidateSpaceQrImageCache: async (spaceId: number): Promise<void> => {
    await input.redisService.delByPattern(buildSpaceQrImagePattern(spaceId));
  },
});
