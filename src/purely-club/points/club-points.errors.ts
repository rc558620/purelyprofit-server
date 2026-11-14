import {
  clubBusinessError,
  type ClubBusinessErrorPayload,
} from '../shared/club-business-errors';

/** 积分明细链路业务错误码；码值契约见 shared/club-business-errors.ts */
export const CLUB_POINTS_ERROR_CODE = {
  PARAM_CURSOR_PARSE_FAILED: 'CLUB_POINTS_PARAM_CURSOR_PARSE_FAILED',
  PARAM_CURSOR_INVALID: 'CLUB_POINTS_PARAM_CURSOR_INVALID',
  PARAM_CURSOR_TIME_INVALID: 'CLUB_POINTS_PARAM_CURSOR_TIME_INVALID',
} as const;

export type ClubPointsErrorCode =
  (typeof CLUB_POINTS_ERROR_CODE)[keyof typeof CLUB_POINTS_ERROR_CODE];

/** 码表校验使用的域前缀 */
export const CLUB_POINTS_ERROR_CODE_PREFIX = 'CLUB_POINTS_';

export function clubPointsError(
  code: ClubPointsErrorCode,
  message: string,
): ClubBusinessErrorPayload<ClubPointsErrorCode> {
  return clubBusinessError(code, message);
}
