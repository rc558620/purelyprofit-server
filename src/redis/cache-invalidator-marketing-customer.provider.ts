import {
  buildMarketingCustomerDetailPattern,
  buildMarketingCustomersListPattern,
  buildMarketingOverviewCacheKey,
} from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  ProfitReadCacheInvalidatorInput,
  ProfitReadCacheInvalidatorRegistry,
} from './cache-invalidator-profit-read.providers';

/**
 * 顾客维度营销缓存失效：营销概览 + 顾客列表 + 顾客详情。
 *
 * 单删概览是不够的——顾客列表缓存 60s、详情缓存 15s，C 端刚落账的余额/积分
 * 在商家端要等 TTL 自然过期才可见。C 端落账路径（扫码点餐 / 团购券 / 充值 /
 * 服务订单）应统一调这个，而不是各自只删概览。
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
      input.redisService.delByPattern(
        buildMarketingCustomersListPattern(storeId),
      ),
      input.redisService.delByPattern(
        buildMarketingCustomerDetailPattern(storeId),
      ),
    ]);
  },
});
