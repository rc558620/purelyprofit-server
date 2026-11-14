import {
  clubBusinessError,
  type ClubBusinessErrorPayload,
} from '../shared/club-business-errors';

/**
 * 门店 / 入店链路业务错误码。
 *
 * 注意：`NO_ACCESSIBLE_STORE` 是冻结的跨仓库历史码，定义在
 * shared/club-business-errors.ts 的 CLUB_LEGACY_ERROR_CODE，不在此表重复定义；
 * 本表只放新规范码，供「选店上下文」之外的门店访问异常使用。
 */
export const CLUB_STORES_ERROR_CODE = {
  RULE_STORE_CHANGED: 'CLUB_STORES_RULE_STORE_CHANGED',
  AUTH_STORE_FORBIDDEN: 'CLUB_STORES_AUTH_STORE_FORBIDDEN',
  AUTH_MEMBER_BANNED: 'CLUB_STORES_AUTH_MEMBER_BANNED',
  PARAM_SCAN_CODE_INVALID: 'CLUB_STORES_PARAM_SCAN_CODE_INVALID',
  PARAM_INVITE_CODE_EMPTY: 'CLUB_STORES_PARAM_INVITE_CODE_EMPTY',
  RESOURCE_INVITE_CODE_NOT_FOUND: 'CLUB_STORES_RESOURCE_INVITE_CODE_NOT_FOUND',
  RESOURCE_STORE_NOT_FOUND: 'CLUB_STORES_RESOURCE_STORE_NOT_FOUND',
  RULE_QR_CODE_DISABLED: 'CLUB_STORES_RULE_QR_CODE_DISABLED',
} as const;

export type ClubStoresErrorCode =
  (typeof CLUB_STORES_ERROR_CODE)[keyof typeof CLUB_STORES_ERROR_CODE];

/** 码表校验使用的域前缀 */
export const CLUB_STORES_ERROR_CODE_PREFIX = 'CLUB_STORES_';

export function clubStoresError(
  code: ClubStoresErrorCode,
  message: string,
): ClubBusinessErrorPayload<ClubStoresErrorCode> {
  return clubBusinessError(code, message);
}
