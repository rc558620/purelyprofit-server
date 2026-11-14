import {
  clubBusinessError,
  type ClubBusinessErrorPayload,
} from '../shared/club-business-errors';

/** 服务订单链路业务错误码；码值契约见 shared/club-business-errors.ts */
export const CLUB_ORDER_ERROR_CODE = {
  RESOURCE_MEMBER_NOT_FOUND: 'CLUB_ORDER_RESOURCE_MEMBER_NOT_FOUND',
  RESOURCE_PRODUCT_NOT_FOUND: 'CLUB_ORDER_RESOURCE_PRODUCT_NOT_FOUND',
  RESOURCE_DRAFT_NOT_FOUND: 'CLUB_ORDER_RESOURCE_DRAFT_NOT_FOUND',
  STATUS_REPLAY_CONFLICT: 'CLUB_ORDER_STATUS_REPLAY_CONFLICT',
  STATUS_DRAFT_DUPLICATE: 'CLUB_ORDER_STATUS_DRAFT_DUPLICATE',
  STATUS_CONFIRM_NOT_ALLOWED: 'CLUB_ORDER_STATUS_CONFIRM_NOT_ALLOWED',
  RULE_STORE_CHANGED: 'CLUB_ORDER_RULE_STORE_CHANGED',
  RULE_POINTS_INSUFFICIENT: 'CLUB_ORDER_RULE_POINTS_INSUFFICIENT',
  RULE_BALANCE_INSUFFICIENT: 'CLUB_ORDER_RULE_BALANCE_INSUFFICIENT',
} as const;

export type ClubOrderErrorCode =
  (typeof CLUB_ORDER_ERROR_CODE)[keyof typeof CLUB_ORDER_ERROR_CODE];

/** 码表校验使用的域前缀 */
export const CLUB_ORDER_ERROR_CODE_PREFIX = 'CLUB_ORDER_';

export function clubOrderError(
  code: ClubOrderErrorCode,
  message: string,
): ClubBusinessErrorPayload<ClubOrderErrorCode> {
  return clubBusinessError(code, message);
}
