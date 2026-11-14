import {
  clubBusinessError,
  type ClubBusinessErrorPayload,
} from '../shared/club-business-errors';

/** 护理档案链路业务错误码；码值契约见 shared/club-business-errors.ts */
export const CLUB_CARE_RECORD_ERROR_CODE = {
  RULE_CARE_NOT_ENABLED: 'CLUB_CARE_RECORD_RULE_CARE_NOT_ENABLED',
} as const;

export type ClubCareRecordErrorCode =
  (typeof CLUB_CARE_RECORD_ERROR_CODE)[keyof typeof CLUB_CARE_RECORD_ERROR_CODE];

/** 码表校验使用的域前缀 */
export const CLUB_CARE_RECORD_ERROR_CODE_PREFIX = 'CLUB_CARE_RECORD_';

export function clubCareRecordError(
  code: ClubCareRecordErrorCode,
  message: string,
): ClubBusinessErrorPayload<ClubCareRecordErrorCode> {
  return clubBusinessError(code, message);
}
