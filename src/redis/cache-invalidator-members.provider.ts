import {
  buildMembersListPattern,
  buildMembersMetaCacheKey,
  buildMembersOverviewCacheKey,
} from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  MembershipCacheInvalidatorInput,
  MembershipCacheInvalidatorRegistry,
} from './cache-invalidator-membership.providers';

export const membersCacheInvalidatorProvider: CacheInvalidatorProvider<
  MembershipCacheInvalidatorInput,
  Pick<MembershipCacheInvalidatorRegistry, 'invalidateMembersDerived'>
> = (input: MembershipCacheInvalidatorInput) => ({
  invalidateMembersDerived: async (storeId: number): Promise<void> => {
    await Promise.all([
      input.redisService.delByPattern(buildMembersListPattern(storeId)),
      input.redisService.del(buildMembersMetaCacheKey(storeId)),
      input.redisService.del(buildMembersOverviewCacheKey(storeId)),
    ]);
  },
});
