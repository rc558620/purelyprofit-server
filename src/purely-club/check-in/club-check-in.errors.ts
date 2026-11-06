import { BadRequestException } from '@nestjs/common';

/**
 * 签到链路业务错误码。
 *
 * 前端按响应体 code 分支、不按文案匹配，因此 code 必须稳定；
 * AllExceptionsFilter 会把 HttpException response.code 透传到响应体。
 * 三个错误码均为状态/资源类冲突，统一用 400（与前端 ApiError.businessCode 一致）。
 */

/** 今日已签到（幂等拒绝） */
export const CHECK_IN_ALREADY_DONE_CODE = 'CHECK_IN_ALREADY_DONE';
/** 活动未开始 / 已结束 / 已停用 */
export const CHECK_IN_ACTIVITY_NOT_ACTIVE_CODE = 'CHECK_IN_ACTIVITY_NOT_ACTIVE';
/** 当前门店未配置签到活动 */
export const CHECK_IN_ACTIVITY_NOT_FOUND_CODE = 'CHECK_IN_ACTIVITY_NOT_FOUND';

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
  return new BadRequestException({
    code,
    message: CHECK_IN_ERROR_MESSAGES[code],
  });
}
