import {
  clubBusinessError,
  type ClubBusinessErrorPayload,
} from '../shared/club-business-errors';

/** 首页链路业务错误码；码值契约见 shared/club-business-errors.ts */
export const CLUB_HOME_ERROR_CODE = {
  PARAM_CONTEXT_MISSING: 'CLUB_HOME_PARAM_CONTEXT_MISSING',
} as const;

export type ClubHomeErrorCode =
  (typeof CLUB_HOME_ERROR_CODE)[keyof typeof CLUB_HOME_ERROR_CODE];

/** 码表校验使用的域前缀 */
export const CLUB_HOME_ERROR_CODE_PREFIX = 'CLUB_HOME_';

export function clubHomeError(
  code: ClubHomeErrorCode,
  message: string,
): ClubBusinessErrorPayload<ClubHomeErrorCode> {
  return clubBusinessError(code, message);
}
