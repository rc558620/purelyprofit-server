import { Prisma, StaffRole, StaffStatus } from '@prisma/client';
import { PaginationMetaDto } from '../../stores/dto/store-response.dto';

export interface ResolvedStaffPagination {
  page: number;
  skip: number;
  take: number;
}

export interface StaffListFilters {
  status?: StaffStatus;
  role?: StaffRole;
  keyword?: string;
}

export function normalizeStaffEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildStaffListWhere(
  storeId: number,
  filters: StaffListFilters,
): Prisma.StaffWhereInput {
  const { status, role, keyword } = filters;

  return {
    storeId,
    ...(status ? { status } : {}),
    ...(role ? { role } : {}),
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: Prisma.QueryMode.insensitive } },
            { email: { contains: keyword, mode: Prisma.QueryMode.insensitive } },
            { phone: { contains: keyword } },
          ],
        }
      : {}),
  };
}

export function buildStaffPaginationMeta(
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

export function resolveStaffPagination(
  page: number | undefined,
  pageSize: number | undefined,
  defaultPageSize: number,
  maxPageSize: number,
): ResolvedStaffPagination {
  const safePage = page && page > 0 ? page : 1;
  const safePageSize = pageSize && pageSize > 0 ? pageSize : defaultPageSize;
  const take = Math.min(safePageSize, maxPageSize);

  return {
    page: safePage,
    skip: (safePage - 1) * take,
    take,
  };
}
