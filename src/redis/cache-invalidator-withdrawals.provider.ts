import {
  buildWithdrawalsListPattern,
  buildWithdrawalsOverviewCacheKey,
} from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  MembershipCacheInvalidatorInput,
  MembershipCacheInvalidatorRegistry,
} from './cache-invalidator-membership.providers';

export const withdrawalsCacheInvalidatorProvider: CacheInvalidatorProvider<
  MembershipCacheInvalidatorInput,
  Pick<MembershipCacheInvalidatorRegistry, 'invalidateWithdrawalsDerived'>
> = (input: MembershipCacheInvalidatorInput) => ({
  invalidateWithdrawalsDerived: async (storeId: number): Promise<void> => {
    await Promise.all([
      input.redisService.del(buildWithdrawalsOverviewCacheKey(storeId)),
      input.redisService.delByPattern(buildWithdrawalsListPattern(storeId)),
    ]);
  },
});
