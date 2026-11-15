import { buildMarketingOverviewCacheKey } from './cache-keys';
import {
  buildClubPromotionsCacheKey,
  buildClubPromotionListCacheKey,
} from './keys/club-cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

/**
 * 营销总览缓存失效（商家端改活动 / 顾客消费等写路径调用）。
 *
 * ⚠️ 必须同时清掉 C 端两份活动缓存，否则 C 端会拿到「活动已改/已停」之外的
 * 旧结论（最坏情况是结算仍按已撤销的活动打折）：
 *  - `club:promotions:store:{storeId}`     —— 定价投影（ClubPromotionRepository）
 *  - `club:promotions:store:{storeId}:list` —— C 端展示列表（ClubPromotionsService）
 *
 * 历史上第二份 key **漏了失效**，C 端活动卡最长要等一个 TTL 才更新，
 * 与定价口径不一致（卡上写着满减、结算却不生效）。
 * 两者形状不同不能共键（见 club-cache-keys 的说明），因此只能成对删除。
 */
export const marketingOverviewCacheInvalidatorProvider: CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Pick<ProfitReadCacheInvalidatorRegistry, 'invalidateMarketingOverview'>
> = (input: ProfitReadCacheInvalidatorInput) => ({
  invalidateMarketingOverview: async (storeId: number): Promise<void> => {
    await Promise.all([
      input.redisService.del(buildMarketingOverviewCacheKey(storeId)),
      input.redisService.del(buildClubPromotionsCacheKey(storeId)),
      input.redisService.del(buildClubPromotionListCacheKey(storeId)),
    ]);
  },
});
