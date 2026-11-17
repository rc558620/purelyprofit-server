import { buildMarketingOverviewCacheKey } from './cache-keys';
import {
  buildClubCheckInPromotionCacheKey,
  buildClubPromotionsCacheKey,
  buildClubPromotionListCacheKey,
  buildClubRechargePackagesCacheKey,
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
 *
 * 充值套餐（`club:recharge-packages:store:{storeId}`）也挂在这里：它同样是
 * `marketing_promotions` 的投影（type=recharge_gift），活动新建 / 编辑 / 启停
 * 之后若不清，C 端充值页最长会拿着旧套餐走 60s。
 *
 * 签到活动配置（`club:check-in-promotion:store:{storeId}`）同理：它是
 * `marketing_promotions` 的 daily_check_in 投影，被首页签到入口每次进场读取。
 * 商家端改签到奖励 / 停用活动后若不清，C 端最多继续按旧配置判定 30s。
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
      input.redisService.del(buildClubRechargePackagesCacheKey(storeId)),
      input.redisService.del(buildClubCheckInPromotionCacheKey(storeId)),
    ]);
  },
});
