import {
  buildMarketingCustomerDetailPattern,
  buildMarketingCustomersListPattern,
  buildMarketingOverviewCacheKey,
} from './cache-keys';
import {
  buildClubCheckInStatusPattern,
  buildClubCustomerConsumptionExistsPattern,
  buildClubMemberSnapshotPattern,
} from './keys/club-cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

/**
 * 顾客维度营销缓存失效：营销概览 + 顾客列表 + 顾客详情 + club 会员快照。
 *
 * 单删概览是不够的——顾客列表缓存 60s、详情缓存 15s、club 会员快照 15s，
 * C 端刚落账的余额/积分在商家端要等 TTL 自然过期才可见。C 端落账路径
 * （扫码点餐 / 团购券 / 充值 / 服务订单）应统一调这个，而不是各自只删概览。
 *
 * 一并清理两份 C 端派生结论：
 *  - `club:check-in-status:store:{storeId}:user:*`：签到状态里含积分余额，
 *    充值 / 消费 / 签到落账后必须重新计算，不能等 15s TTL；
 *  - `club:consumption-exists:store:{storeId}:customer:*`：首单资格，
 *    首次消费落账后必须立刻从「首单」翻转为「非首单」。
 */
export const marketingCustomerDerivedCacheInvalidatorProvider: CacheInvalidatorProvider<
  ProfitReadCacheInvalidatorInput,
  Pick<ProfitReadCacheInvalidatorRegistry, 'invalidateMarketingCustomerDerived'>
> = (input: ProfitReadCacheInvalidatorInput) => ({
  invalidateMarketingCustomerDerived: async (
    storeId: number,
  ): Promise<void> => {
    await Promise.all([
      input.redisService.del(buildMarketingOverviewCacheKey(storeId)),
      // 多个模式合并成一次 keyspace 遍历，删除集合与逐模式扫描一致
      input.redisService.delByPatterns([
        buildMarketingCustomersListPattern(storeId),
        buildMarketingCustomerDetailPattern(storeId),
        // club 会员快照缓存（club:member-snapshot:store:{storeId}:user:*）
        buildClubMemberSnapshotPattern(storeId),
        // club 签到状态缓存（club:check-in-status:store:{storeId}:user:*）
        buildClubCheckInStatusPattern(storeId),
        // club 首单资格缓存（club:consumption-exists:store:{storeId}:customer:*）
        buildClubCustomerConsumptionExistsPattern(storeId),
      ]),
    ]);
  },
});
