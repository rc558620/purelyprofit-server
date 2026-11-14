import { BadRequestException } from '@nestjs/common';
import {
  CLUB_LEGACY_ERROR_CODE,
  clubBusinessError,
} from '../shared/club-business-errors';

/**
 * 签到链路业务错误码。
 *
 * 三个码值属于冻结的历史码（CLUB_LEGACY_ERROR_CODE），前端已按字面量分支，
 * 禁止改名或「规范化」；AllExceptionsFilter 会把 response.code 透传到响应体。
 *
 * 与共享层「message 由调用方显式传入」并不冲突：签到全是固定文案、没有动态
 * 场景，因此保留本域唯一的 code→message 映射；但异常载荷统一走
 * clubBusinessError 构造，不再自建一套载荷形状。
 */

/** 今日已签到（幂等拒绝） */
export const CHECK_IN_ALREADY_DONE_CODE =
  CLUB_LEGACY_ERROR_CODE.CHECK_IN_ALREADY_DONE;
/** 活动未开始 / 已结束 / 已停用 */
export const CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE =
  CLUB_LEGACY_ERROR_CODE.CHECK_IN_ACTIVITY_NOT_ACTIVE;
/** 当前门店未配置签到活动 */
export const CHECK_IN_ACTIVITY_NOT_FOUND_CODE =
  CLUB_LEGACY_ERROR_CODE.CHECK_IN_ACTIVITY_NOT_FOUND;

export const CHECK_IN_ALREADY_DONE_MESSAGE = '今日已签到';
export const CHECK_IN_ACTIVITY_NOT_ACTIVE_MESSAGE = '签到活动暂未开启';
export const CHECK_IN_ACTIVITY_NOT_FOUND_MESSAGE = '当前门店暂未开启签到活动';

export type ClubCheckInErrorCode =
  | typeof CHECK_IN_ALREADY_DONE_CODE
  | typeof CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE
  | typeof CHECK_IN_ACTIVITY_NOT_FOUND_CODE;

const CHECK_IN_ERROR_MESSAGES: Record<ClubCheckInErrorCode, string> = {
  [CHECK_IN_ALREADY_DONE_CODE]: CHECK_IN_ALREADY_DONE_MESSAGE,
  [CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE]: CHECK_IN_ACTIVITY_NOT_ACTIVE_MESSAGE,
  [CHECK_IN_ACTIVITY_NOT_FOUND_CODE]: CHECK_IN_ACTIVITY_NOT_FOUND_MESSAGE,
};

/** 统一构造携带业务码的异常，避免 controller / service 内散落字面量 */
export function buildCheckInBusinessError(
  code: ClubCheckInErrorCode,
): BadRequestException {
  return new BadRequestException(
    clubBusinessError(code, CHECK_IN_ERROR_MESSAGES[code]),
  );
}
