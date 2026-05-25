import { type Prisma, type Staff } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';

export interface QueryStaffPageParams {
  where: Prisma.StaffWhereInput;
  skip: number;
  take: number;
}

export interface QueryStaffPageResult {
  items: Staff[];
  total: number;
}

export async function queryStaffPage(
  prisma: PrismaService,
  params: QueryStaffPageParams,
): Promise<QueryStaffPageResult> {
  const [items, total] = await Promise.all([
    prisma.staff.findMany({
      where: params.where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: params.skip,
      take: params.take,
    }),
    prisma.staff.count({ where: params.where }),
  ]);

  return {
    items,
    total,
  };
}
