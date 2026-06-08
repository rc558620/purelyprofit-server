import { buildPlatformMembershipDerivedPattern } from './cache-keys';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type {
  MembershipCacheInvalidatorInput,
  MembershipCacheInvalidatorRegistry,
} from './cache-invalidator-membership.providers';

export const platformMembershipDerivedCacheInvalidatorProvider: CacheInvalidatorProvider<
  MembershipCacheInvalidatorInput,
  Pick<
    MembershipCacheInvalidatorRegistry,
    'invalidatePlatformMembershipDerived'
  >
> = (input: MembershipCacheInvalidatorInput) => ({
  invalidatePlatformMembershipDerived: async (
    storeId: number,
  ): Promise<void> => {
    await input.redisService.delByPattern(
      buildPlatformMembershipDerivedPattern(storeId),
    );
  },
});
