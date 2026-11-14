import {
  clubBusinessError,
  type ClubBusinessErrorPayload,
} from '../shared/club-business-errors';

/** 消费记录链路业务错误码；码值契约见 shared/club-business-errors.ts */
export const CLUB_RECORD_ERROR_CODE = {
  PARAM_CURSOR_PARSE_FAILED: 'CLUB_RECORD_PARAM_CURSOR_PARSE_FAILED',
  PARAM_CURSOR_INVALID: 'CLUB_RECORD_PARAM_CURSOR_INVALID',
  PARAM_CURSOR_TIME_INVALID: 'CLUB_RECORD_PARAM_CURSOR_TIME_INVALID',
} as const;

export type ClubRecordErrorCode =
  (typeof CLUB_RECORD_ERROR_CODE)[keyof typeof CLUB_RECORD_ERROR_CODE];

/** 码表校验使用的域前缀 */
export const CLUB_RECORD_ERROR_CODE_PREFIX = 'CLUB_RECORD_';

export function clubRecordError(
  code: ClubRecordErrorCode,
  message: string,
): ClubBusinessErrorPayload<ClubRecordErrorCode> {
  return clubBusinessError(code, message);
}
