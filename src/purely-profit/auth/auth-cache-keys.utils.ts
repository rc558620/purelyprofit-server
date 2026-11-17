// 鉴权链路 Redis key 构造（纯函数，仅依赖 auth.constants 前缀）
import {
  AUTH_PASSWORD_RESET_CODE_KEY_PREFIX,
  AUTH_REGISTER_CODE_KEY_PREFIX,
  AUTH_SMS_SEND_COOLDOWN_KEY_PREFIX,
  AUTH_CODE_ATTEMPTS_KEY_PREFIX,
  AUTH_TOKEN_VERSION_KEY_PREFIX,
  AUTH_USER_CACHE_KEY_PREFIX,
  AUTH_USER_RELATED_STORE_IDS_CACHE_KEY_PREFIX,
  AUTH_LEGACY_OWNER_ABSENT_KEY_PREFIX,
  PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX,
  STORE_PROFILE_KEY_PREFIX,
} from './auth.constants';
import type { AuthProductScope } from './auth-account.types';

export function buildPasswordResetCodeKey(
  scope: AuthProductScope,
  phone: string,
): string {
  return `${AUTH_PASSWORD_RESET_CODE_KEY_PREFIX}${scope}:${phone}`;
}

export function buildRegisterCodeKey(
  scope: AuthProductScope,
  phone: string,
): string {
  return `${AUTH_REGISTER_CODE_KEY_PREFIX}${scope}:${phone}`;
}

export function buildSmsSendCooldownKey(
  scene:
    | 'register'
    | 'login'
    | 'password-reset'
    | 'login_or_register'
    | 'bind_phone',
  scope: AuthProductScope,
  phone: string,
): string {
  return `${AUTH_SMS_SEND_COOLDOWN_KEY_PREFIX}${scene}:${scope}:${phone}`;
}

/**
 * 构建验证码校验尝试次数的缓存 key
 */
export function buildCodeAttemptsKey(
  codeType: 'register' | 'password-reset',
  scope: AuthProductScope,
  phone: string,
): string {
  return `${AUTH_CODE_ATTEMPTS_KEY_PREFIX}${codeType}:${scope}:${phone}`;
}

export function buildTokenVersionKey(userId: number): string {
  return `${AUTH_TOKEN_VERSION_KEY_PREFIX}${userId}`;
}

export function buildStoreProfileKey(storeId: number): string {
  return `${STORE_PROFILE_KEY_PREFIX}${storeId}`;
}

export function buildPulseAdminMemberBanReasonKey(storeId: number): string {
  return `${PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX}${storeId}:ban-reason`;
}

/**
 * 构建 JWT validate 链路中 user 信息的缓存 key
 */
export function buildUserCacheKey(userId: number): string {
  return `${AUTH_USER_CACHE_KEY_PREFIX}${userId}`;
}

/**
 * 构建 JWT validate 链路中用户关联门店 ID 的缓存 key
 */
export function buildUserRelatedStoreIdsCacheKey(userId: number): string {
  return `${AUTH_USER_RELATED_STORE_IDS_CACHE_KEY_PREFIX}${userId}`;
}

/**
 * 构建「该账号无 owner 门店」负缓存 key。
 *
 * 用于短路遗留店主补齐的落空查询：C 端会员账号永远不会有 stores.owner_id，
 * 但每次鉴权（membership rows 为空时）都会跑一次 owner 门店查询。
 */
export function buildLegacyOwnerAbsentCacheKey(userId: number): string {
  return `${AUTH_LEGACY_OWNER_ABSENT_KEY_PREFIX}${userId}`;
}
