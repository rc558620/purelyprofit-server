// 平台会员读链路缓存装载：统一「有界陈旧」刷新口径（TTL + 后台刷新窗口）
import { buildCacheRefreshTaskKey } from '../../../redis/keys';
import type { RefreshableCacheService } from '../../../redis/refreshable-cache.service';

const PLATFORM_MEMBERSHIP_READ_CACHE_TTL_SECONDS = 120;
const PLATFORM_MEMBERSHIP_READ_REFRESH_AFTER_MS = 30_000;
const PLATFORM_MEMBERSHIP_LEDGER_CACHE_TTL_SECONDS = 90;
const PLATFORM_MEMBERSHIP_LEDGER_REFRESH_AFTER_MS = 20_000;

/** 会员中心 / 档案 / 合伙人档案等读模型：120s TTL，30s 起后台刷新 */
export const loadPlatformMembershipCachedRead = <T>(
  refreshableCache: RefreshableCacheService,
  cacheKey: string,
  loadValue: () => Promise<T>,
): Promise<T> =>
  refreshableCache.getOrLoadRefreshableJson({
    cacheKey,
    taskKey: buildCacheRefreshTaskKey(cacheKey),
    ttlSeconds: PLATFORM_MEMBERSHIP_READ_CACHE_TTL_SECONDS,
    refreshAfterMs: PLATFORM_MEMBERSHIP_READ_REFRESH_AFTER_MS,
    loadValue,
  });

/** 积分流水 / 活动中心等台账读模型：90s TTL，20s 起后台刷新 */
export const loadPlatformMembershipCachedLedger = <T>(
  refreshableCache: RefreshableCacheService,
  cacheKey: string,
  loadValue: () => Promise<T>,
): Promise<T> =>
  refreshableCache.getOrLoadRefreshableJson({
    cacheKey,
    taskKey: buildCacheRefreshTaskKey(cacheKey),
    ttlSeconds: PLATFORM_MEMBERSHIP_LEDGER_CACHE_TTL_SECONDS,
    refreshAfterMs: PLATFORM_MEMBERSHIP_LEDGER_REFRESH_AFTER_MS,
    loadValue,
  });
