import { BadRequestException } from '@nestjs/common';
import {
  addShanghaiDays,
  formatShanghaiDate,
  getShanghaiDayEndMs,
  parseShanghaiDateText,
} from '../../shared/shanghai-time.utils';

const SECONDS_PER_DAY = 86_400;
const MILLISECONDS_PER_SECOND = 1_000;

/** 防抖占位活到上海自然日终，避免跨日误判且不给 Redis 留长期垃圾 */
export function buildDedupTtlSeconds(serverTime: number): number {
  const remainingSeconds = Math.ceil(
    (getShanghaiDayEndMs(serverTime) + 1 - serverTime) /
      MILLISECONDS_PER_SECOND,
  );
  return Math.max(1, Math.min(remainingSeconds, SECONDS_PER_DAY));
}

/**
 * 连续天数：今日已签则从今日回溯，未签则从昨日回溯
 * （当天未签时展示截至昨日的连续天数，次日签到自然 +1）。
 */
export function computeContinuousDays(
  checkedDates: string[],
  today: string,
  todayCheckedIn: boolean,
): number {
  const dateSet = new Set(checkedDates);
  let cursor = todayCheckedIn ? today : previousShanghaiDate(today);
  let days = 0;
  while (dateSet.has(cursor)) {
    days += 1;
    cursor = previousShanghaiDate(cursor);
  }
  return days;
}

function previousShanghaiDate(dateText: string): string {
  return formatShanghaiDate(
    addShanghaiDays(parseShanghaiDateText(dateText), -1),
  );
}

/**
 * 下发给前端的签到日期窗口：当前自然月 + 上一个自然月。
 *
 * 为什么不是「最近 30 天」：月末（如 31 日）回溯 30 天会漏掉当月 1 日，
 * 月历首日就会漏打点；按自然月对齐才是月历的最小完备集合。
 * 为什么保留上月：跨月时「上月末连续签到」仍要在月历/连续天数说明里可见，
 * 且线上旧版本若支持历史月浏览也不会立刻失效。
 *
 * ⚠️ 只用于**响应下发**：连续天数必须用完整历史窗口计算，
 * 用裁剪后的集合回溯会在月初把连签截断。
 */
const CHECK_IN_DISPLAY_MONTH_COUNT = 2;
const MONTH_KEY_SLICE_END = 7;

export function filterRecentMonthDates(
  checkedDates: string[],
  serverTime: number,
): string[] {
  const today = formatShanghaiDate(serverTime);
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, MONTH_KEY_SLICE_END));

  const allowedPrefixes = new Set<string>();
  for (let index = 0; index < CHECK_IN_DISPLAY_MONTH_COUNT; index += 1) {
    allowedPrefixes.add(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }

  return checkedDates.filter((date) =>
    allowedPrefixes.has(date.slice(0, MONTH_KEY_SLICE_END)),
  );
}

/** Prisma 唯一约束冲突（P2002）是签到幂等的最终权威 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** 从业务异常中取稳定错误码，系统异常退化为类型名 */
export function readErrorCode(error: unknown): string {
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      typeof (response as { code?: unknown }).code === 'string'
    ) {
      return (response as { code: string }).code;
    }
  }
  return error instanceof Error ? error.name : 'UNKNOWN';
}
