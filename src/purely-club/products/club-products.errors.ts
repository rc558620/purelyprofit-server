import {
  clubBusinessError,
  type ClubBusinessErrorPayload,
} from '../shared/club-business-errors';

/** 服务商品链路业务错误码；码值契约见 shared/club-business-errors.ts */
export const CLUB_PRODUCT_ERROR_CODE = {
  RESOURCE_PRODUCT_NOT_FOUND: 'CLUB_PRODUCT_RESOURCE_PRODUCT_NOT_FOUND',
  PARAM_CONTEXT_MISSING: 'CLUB_PRODUCT_PARAM_CONTEXT_MISSING',
} as const;

export type ClubProductErrorCode =
  (typeof CLUB_PRODUCT_ERROR_CODE)[keyof typeof CLUB_PRODUCT_ERROR_CODE];

/** 码表校验使用的域前缀 */
export const CLUB_PRODUCT_ERROR_CODE_PREFIX = 'CLUB_PRODUCT_';

export function clubProductError(
  code: ClubProductErrorCode,
  message: string,
): ClubBusinessErrorPayload<ClubProductErrorCode> {
  return clubBusinessError(code, message);
}
