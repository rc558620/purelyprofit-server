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
