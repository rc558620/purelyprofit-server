import {
  FINANCE_DEFAULT_PAGE,
  FINANCE_DEFAULT_PAGE_SIZE,
  type PaginationState,
} from './finance.types';

export function buildPaginationState(
  page?: number,
  pageSize?: number,
): PaginationState {
  return {
    page: page ?? FINANCE_DEFAULT_PAGE,
    pageSize: pageSize ?? FINANCE_DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 0,
  };
}

export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationState {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export function paginateArray<T>(items: T[], meta: PaginationState): T[] {
  const start = (meta.page - 1) * meta.pageSize;
  return items.slice(start, start + meta.pageSize);
}
