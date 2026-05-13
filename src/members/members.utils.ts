import { PaginationMetaDto } from '../stores/dto/store-response.dto';
import { type MemberStatusValue } from './dto/member-response.dto';

export type MemberStatusDb = 'ACTIVE' | 'INACTIVE' | 'BANNED';

export interface BuildMemberListWhereParams {
  storeId: number;
  status?: MemberStatusDb;
  level?: string;
  keyword?: string;
}

export interface ResolvedPagination {
  page: number;
  skip: number;
  take: number;
}

export function toApiMemberStatus(status: MemberStatusDb): MemberStatusValue {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'INACTIVE':
      return 'inactive';
    case 'BANNED':
      return 'banned';
  }
}

export function toDbMemberStatus(
  status?: MemberStatusValue,
): MemberStatusDb | undefined {
  if (!status) {
    return undefined;
  }

  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'inactive':
      return 'INACTIVE';
    case 'banned':
      return 'BANNED';
  }
}

export function normalizePhone(phone?: string): string | undefined {
  if (phone === undefined) {
    return undefined;
  }

  const trimmedPhone = phone.trim();
  return trimmedPhone === '' ? undefined : trimmedPhone;
}

export function normalizeOptionalText(
  value?: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === '' ? null : trimmedValue;
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
