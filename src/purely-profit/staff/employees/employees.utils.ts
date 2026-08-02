import { PaginationMetaDto } from '../../stores/dto/store-response.dto';
import {
  formatShanghaiYearMonth,
  getShanghaiMonth,
  getShanghaiYear,
  makeShanghaiMs,
} from '../../../shared/shanghai-time.utils';

type DecimalLike = {
  toString(): string;
};

export interface ResolvedPagination {
  page: number;
  skip: number;
  take: number;
}

export function toTimestampMs(value: Date): number {
  return value.getTime();
}

export function toOptionalTimestampMs(value?: Date | null): number | undefined {
  return value ? value.getTime() : undefined;
}

export function toOptionalText(value?: string | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === '' ? undefined : trimmedValue;
}

export function toNullableText(value?: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === '' ? null : trimmedValue;
}

export function toDecimalNumber(value?: DecimalLike | number | null): number {
  if (value === undefined || value === null) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  return Number(value.toString());
}

export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number,
): PaginationMetaDto {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}

export function resolvePagination(
  page: number | undefined,
  pageSize: number | undefined,
  defaultPageSize: number,
  maxPageSize: number,
): ResolvedPagination {
  const safePage = page && page > 0 ? page : 1;
  const safePageSize = pageSize && pageSize > 0 ? pageSize : defaultPageSize;
  const take = Math.min(safePageSize, maxPageSize);

  return {
    page: safePage,
    skip: (safePage - 1) * take,
    take,
  };
}

export function getCurrentMonthString(now = new Date()): string {
  return formatShanghaiYearMonth(now.getTime());
}

/** 指定业务月的上海时区「当月 1 日 00:00」（month 为 1-based）。 */
export function getMonthStart(year: number, month: number): Date {
  return new Date(makeShanghaiMs(year, month - 1, 1));
}

/** 指定业务月的上海时区「次月 1 日 00:00」（month 为 1-based，作排他上界）。 */
export function getMonthEndExclusive(year: number, month: number): Date {
  return new Date(makeShanghaiMs(year, month, 1));
}

/**
 * 按上海时区构建业务月/年查询范围。
 * 排班（employeeShift.date，上海日界）与工资单（EmployeePayroll.month，
 * UTC 月初零点，上海墙钟落在同月）的月界过滤均以此为统一口径。
 */
export function buildDateRange(
  year?: number,
  month?: number,
): { gte: Date; lt: Date } | undefined {
  if (!year) {
    return undefined;
  }

  if (!month || month === 0) {
    return {
      gte: new Date(makeShanghaiMs(year, 0, 1)),
      lt: new Date(makeShanghaiMs(year + 1, 0, 1)),
    };
  }

  return {
    gte: getMonthStart(year, month),
    lt: getMonthEndExclusive(year, month),
  };
}

/** 当前业务月（上海时区判定）的月初零点。 */
export function getStartOfCurrentMonth(now = new Date()): Date {
  const nowMs = now.getTime();
  return new Date(
    makeShanghaiMs(getShanghaiYear(nowMs), getShanghaiMonth(nowMs), 1),
  );
}

/**
 * 将 YYYY-MM 格式字符串转为 UTC 月初 Date（与 EmployeePayroll.month DateTime 字段匹配）。
 * 注意：EmployeePayroll.month 存储约定为「UTC 当月 1 号零点」（其上海墙钟落在同月，
 * 用上海月界范围查询同样能命中），此处为兼容存量数据保持存储口径不变。
 * 调用方应先通过 assertPayrollMonthFormat 校验格式合法性。
 */
export function normalizeMonthValue(month: string): Date {
  const trimmed = month.trim();
  const [year, mon] = trimmed.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
}
