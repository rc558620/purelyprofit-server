/**
 * 分页入参归一与响应元信息拼装。
 *
 * `resolvePagination` 负责把不可信入参收敛到合法区间（页码 ≥ 1、页大小 ≤ 上限），
 * `buildPaginationMeta` 负责对外返回的元信息，两者必须成对使用，
 * 否则会出现 skip 与 meta.page 口径不一致。
 */
import { PaginationMetaDto } from '../stores/dto/store-response.dto';

export interface ResolvedPagination {
  page: number;
  skip: number;
  take: number;
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
