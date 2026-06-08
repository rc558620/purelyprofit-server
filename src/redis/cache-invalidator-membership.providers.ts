import { buildCacheInvalidatorRegistry } from './cache-invalidator.registry';
import { membersCacheInvalidatorProvider } from './cache-invalidator-members.provider';
import { platformMembershipDerivedCacheInvalidatorProvider } from './cache-invalidator-platform-membership-derived.provider';
import { withdrawalsCacheInvalidatorProvider } from './cache-invalidator-withdrawals.provider';
import type { CacheInvalidatorProvider } from './cache-invalidator.registry';
import type { RedisService } from './redis.service';

export type MembershipCacheInvalidatorInput = {
  redisService: Pick<RedisService, 'del' | 'delByPattern'>;
};

export type MembershipCacheInvalidatorRegistry = {
  invalidateMembersDerived: (storeId: number) => Promise<void>;
  invalidateWithdrawalsDerived: (storeId: number) => Promise<void>;
  invalidatePlatformMembershipDerived: (storeId: number) => Promise<void>;
};

const membershipCacheInvalidatorProviders: readonly CacheInvalidatorProvider<
  MembershipCacheInvalidatorInput,
  Partial<MembershipCacheInvalidatorRegistry>
>[] = [
  membersCacheInvalidatorProvider,
  withdrawalsCacheInvalidatorProvider,
  platformMembershipDerivedCacheInvalidatorProvider,
];

export function createMembershipCacheInvalidatorRegistry(
  input: MembershipCacheInvalidatorInput,
): MembershipCacheInvalidatorRegistry {
  return buildCacheInvalidatorRegistry<
    MembershipCacheInvalidatorInput,
    MembershipCacheInvalidatorRegistry
  >(membershipCacheInvalidatorProviders, input);
}
