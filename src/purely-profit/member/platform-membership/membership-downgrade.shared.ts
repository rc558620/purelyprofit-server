import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import {
  DAY_MS,
  MANUAL_ENTRY_QUOTA_KEY_PREFIX,
  MEMBERSHIP_EXPIRING_SOON_DAYS,
} from './membership-downgrade.constants';
import type { StoreDowngradeState } from './membership-downgrade.types';

/**
 * 降级态判定所需的纯函数。
 *
 * 与 Redis / Prisma 无关，便于单独验证「按上海时区自然日切分」「剩余天数」
 * 这类容易算错的口径。
 */

/**
 * 降级态缓存 key。
 *
 * 必须遵循 `profit:platform-membership:*:store:{storeId}` 这一格式 ——
 * 续费下单时会调用 invalidatePlatformMembershipDerived 按该 pattern 批量删除，
 * 从而让「续费后立即恢复」生效。若另起一套 key 前缀，续费后仍会读到旧的过期态。
 */
export function buildDowngradeStateCacheKey(storeId: number): string {
  return `profit:platform-membership:downgrade-state:store:${storeId}`;
}

/** 手动录单计数 key：按上海时区自然日分片，次日 0 点自动失效 */
export function buildManualEntryKey(storeId: number): string {
  const dayStart = getShanghaiDayStartMs(Date.now());
  return `${MANUAL_ENTRY_QUOTA_KEY_PREFIX}${storeId}:${dayStart}`;
}

/** 计数 key 的 TTL（秒）：覆盖到下一个上海自然日零点 */
export function ttlUntilNextDay(): number {
  const nextDayStart = getShanghaiDayStartMs(Date.now()) + DAY_MS;
  return Math.max(1, Math.ceil((nextDayStart - Date.now()) / 1000));
}

export function calcRemainingDays(expiredAt: number | null): number {
  if (expiredAt === null) {
    return 0;
  }

  return Math.max(0, Math.ceil((expiredAt - Date.now()) / DAY_MS));
}

/** 是否处于续费提醒窗口（到期前 N 天，含当天） */
export function isDowngradeExpiringSoon(state: StoreDowngradeState): boolean {
  if (state.isExpired || state.expiredAt === null) {
    return false;
  }

  return state.remainingDays <= MEMBERSHIP_EXPIRING_SOON_DAYS;
}

/**
 * 缓存值是否完整。
 *
 * 逐字段校验，避免半截数据（例如缺少 `remainingDays`）被当成有效状态——
 * 那会让门店被静默按「未过期」或「已过期」处理。
 */
export function isCompleteDowngradeState(
  value: unknown,
): value is StoreDowngradeState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const raw = value as Partial<Record<keyof StoreDowngradeState, unknown>>;

  return (
    typeof raw.isExpired === 'boolean' &&
    typeof raw.level === 'string' &&
    typeof raw.remainingDays === 'number' &&
    (raw.expiredAt === null || typeof raw.expiredAt === 'number')
  );
}
