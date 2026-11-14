import {
  clubBusinessError,
  type ClubBusinessErrorPayload,
} from '../shared/club-business-errors';

/**
 * 客存（寄存）链路业务错误码；码值契约见 shared/club-business-errors.ts。
 * `AUTH_WS_*` 用于客存网关的 Socket.IO 连接鉴权，与 HTTP 接口鉴权码区分。
 */
export const CLUB_CUSTODY_ERROR_CODE = {
  RESOURCE_ORDER_NOT_FOUND: 'CLUB_CUSTODY_RESOURCE_ORDER_NOT_FOUND',
  STATUS_ORDER_CHANGED: 'CLUB_CUSTODY_STATUS_ORDER_CHANGED',
  STATUS_PICKUP_NOT_ALLOWED: 'CLUB_CUSTODY_STATUS_PICKUP_NOT_ALLOWED',
  RULE_PICKUP_QTY_EXHAUSTED: 'CLUB_CUSTODY_RULE_PICKUP_QTY_EXHAUSTED',
  RESOURCE_MEMBER_NOT_FOUND: 'CLUB_CUSTODY_RESOURCE_MEMBER_NOT_FOUND',
  PARAM_STORE_ID_INVALID: 'CLUB_CUSTODY_PARAM_STORE_ID_INVALID',
  AUTH_WS_TOKEN_MISSING: 'CLUB_CUSTODY_AUTH_WS_TOKEN_MISSING',
  AUTH_WS_TOKEN_INVALID: 'CLUB_CUSTODY_AUTH_WS_TOKEN_INVALID',
  AUTH_WS_USER_NOT_FOUND: 'CLUB_CUSTODY_AUTH_WS_USER_NOT_FOUND',
  AUTH_WS_CONNECTION_UNAUTHENTICATED:
    'CLUB_CUSTODY_AUTH_WS_CONNECTION_UNAUTHENTICATED',
} as const;

export type ClubCustodyErrorCode =
  (typeof CLUB_CUSTODY_ERROR_CODE)[keyof typeof CLUB_CUSTODY_ERROR_CODE];

/** 码表校验使用的域前缀 */
export const CLUB_CUSTODY_ERROR_CODE_PREFIX = 'CLUB_CUSTODY_';

export function clubCustodyError(
  code: ClubCustodyErrorCode,
  message: string,
): ClubBusinessErrorPayload<ClubCustodyErrorCode> {
  return clubBusinessError(code, message);
}
