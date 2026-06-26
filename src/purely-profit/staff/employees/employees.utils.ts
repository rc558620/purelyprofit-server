import { PaginationMetaDto } from '../../stores/dto/store-response.dto';

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
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthStart(year: number, month: number): Date {
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

export function getMonthEndExclusive(year: number, month: number): Date {
  return new Date(year, month, 1, 0, 0, 0, 0);
}

export function buildDateRange(
  year?: number,
  month?: number,
): { gte: Date; lt: Date } | undefined {
  if (!year) {
    return undefined;
  }

  if (!month || month === 0) {
    return {
      gte: new Date(year, 0, 1, 0, 0, 0, 0),
      lt: new Date(year + 1, 0, 1, 0, 0, 0, 0),
    };
  }

  return {
    gte: getMonthStart(year, month),
    lt: getMonthEndExclusive(year, month),
  };
}

export function getStartOfCurrentMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * 将 YYYY-MM 格式字符串转为 UTC 月初 Date（与 EmployeePayroll.month DateTime 字段匹配）。
 * 调用方应先通过 assertPayrollMonthFormat 校验格式合法性。
 */
export function normalizeMonthValue(month: string): Date {
  const trimmed = month.trim();
  const [year, mon] = trimmed.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
}
