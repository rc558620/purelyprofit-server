import {
  clubBusinessError,
  type ClubBusinessErrorPayload,
} from '../shared/club-business-errors';

/** 会员档案链路业务错误码；码值契约见 shared/club-business-errors.ts */
export const CLUB_MEMBER_ERROR_CODE = {
  RESOURCE_ACCOUNT_NOT_FOUND: 'CLUB_MEMBER_RESOURCE_ACCOUNT_NOT_FOUND',
} as const;

export type ClubMemberErrorCode =
  (typeof CLUB_MEMBER_ERROR_CODE)[keyof typeof CLUB_MEMBER_ERROR_CODE];

/** 码表校验使用的域前缀 */
export const CLUB_MEMBER_ERROR_CODE_PREFIX = 'CLUB_MEMBER_';

export function clubMemberError(
  code: ClubMemberErrorCode,
  message: string,
): ClubBusinessErrorPayload<ClubMemberErrorCode> {
  return clubBusinessError(code, message);
}
