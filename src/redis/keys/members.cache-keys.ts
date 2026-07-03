type MembersListCacheQuery = {
  status?: string;
  level?: string;
  keyword?: string;
  partner?: boolean;
  page: number;
  pageSize: number;
};

type WithdrawalsListCacheQuery = {
  status?: string;
};

// ── Members List 缓存键 ──

export function buildMembersListCacheKey(
  storeId: number,
  query: MembersListCacheQuery,
): string {
  return [
    'profit:members:list',
    `store:${storeId}`,
    `status:${query.status ?? 'all'}`,
    `level:${query.level ?? 'all'}`,
    `keyword:${encodeURIComponent(query.keyword ?? 'na')}`,
    `partner:${query.partner === true ? 'true' : 'all'}`,
    `page:${query.page}`,
    `pageSize:${query.pageSize}`,
  ].join(':');
}

export function buildMembersListPattern(storeId: number): string {
  return `profit:members:list:store:${storeId}:*`;
}

// ── Members Meta 缓存键 ──

export function buildMembersMetaCacheKey(storeId: number): string {
  return `profit:members:meta:store:${storeId}`;
}

export function buildMembersMetaPattern(storeId: number): string {
  return `profit:members:meta:store:${storeId}:*`;
}

export function buildMembersMetaAllPattern(): string {
  return 'profit:members:meta:store:*';
}

export function parseMembersMetaCacheKey(cacheKey: string): {
  storeId: number;
} | null {
  const match = /^profit:members:meta:store:(\d+)$/.exec(cacheKey);
  if (!match) {
    return null;
  }

  return {
    storeId: Number(match[1]),
  };
}

// ── Members Overview 缓存键 ──

export function buildMembersOverviewCacheKey(storeId: number): string {
  return `profit:members:overview:store:${storeId}`;
}

export function buildMembersOverviewPattern(storeId: number): string {
  return `profit:members:overview:store:${storeId}:*`;
}

export function buildMembersOverviewAllPattern(): string {
  return 'profit:members:overview:store:*';
}

export function parseMembersOverviewCacheKey(cacheKey: string): {
  storeId: number;
} | null {
  const match = /^profit:members:overview:store:(\d+)$/.exec(cacheKey);
  if (!match) {
    return null;
  }

  return {
    storeId: Number(match[1]),
  };
}

// ── Withdrawals 缓存键 ──

export function buildWithdrawalsOverviewCacheKey(storeId: number): string {
  return `profit:withdrawals:overview:store:${storeId}`;
}

export function buildWithdrawalsListCacheKey(
  storeId: number,
  query: WithdrawalsListCacheQuery,
): string {
  return `profit:withdrawals:list:store:${storeId}:status:${query.status ?? 'all'}`;
}

export function buildWithdrawalsListPattern(storeId: number): string {
  return `profit:withdrawals:list:store:${storeId}:status:*`;
}

// ── Platform Membership 缓存键 ──

export function buildPlatformMembershipCenterCacheKey(storeId: number): string {
  return `profit:platform-membership:center:store:${storeId}`;
}

export function buildPlatformMembershipProfileCacheKey(
  storeId: number,
): string {
  return `profit:platform-membership:profile:store:${storeId}`;
}

export function buildPlatformMembershipOrdersCacheKey(storeId: number): string {
  return `profit:platform-membership:orders:store:${storeId}`;
}

export function buildPlatformMembershipPointsLogsCacheKey(
  storeId: number,
): string {
  return `profit:platform-membership:points-logs:store:${storeId}`;
}

export function buildPlatformMembershipBeanLogsCacheKey(
  storeId: number,
): string {
  return `profit:platform-membership:bean-logs:store:${storeId}`;
}

export function buildPlatformMembershipPromoCenterCacheKey(
  storeId: number,
): string {
  return `profit:platform-membership:promo-center:store:${storeId}`;
}

export function buildPlatformMembershipPartnerProfileCacheKey(
  storeId: number,
): string {
  return `profit:platform-membership:partner-profile:store:${storeId}`;
}

export function buildPlatformMembershipDerivedPattern(storeId: number): string {
  return `profit:platform-membership:*:store:${storeId}`;
}
