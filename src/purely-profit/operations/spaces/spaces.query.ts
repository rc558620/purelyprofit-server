import { Prisma } from '@prisma/client';
import type { ListSpacesQueryDto } from './dto/space.dto';

export const SPACE_WITH_RELATIONS_INCLUDE = {
  type: {
    select: {
      id: true,
      name: true,
    },
  },
  zone: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.SpaceInclude;

export function normalizeTargetSortOrder(value: number, max: number): number {
  const safeValue = Number.isInteger(value) ? value : 1;
  return Math.min(Math.max(safeValue, 1), Math.max(max, 1));
}

export function buildListSpacesWhere(
  storeId: number,
  query: ListSpacesQueryDto,
): Prisma.SpaceWhereInput {
  return {
    storeId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.type
      ? {
          type: {
            is: {
              name: query.type.trim(),
            },
          },
        }
      : {}),
    ...(query.zone
      ? {
          zone: {
            is: {
              name: query.zone.trim(),
            },
          },
        }
      : {}),
  };
}

export async function shiftSortOrdersForInsert(
  transaction: Prisma.TransactionClient,
  storeId: number,
  targetSortOrder: number,
): Promise<void> {
  await transaction.space.updateMany({
    where: {
      storeId,
      sortOrder: {
        gte: targetSortOrder,
      },
    },
    data: {
      sortOrder: {
        increment: 1,
      },
    },
  });
}

export async function reorderSpaceSortOrder(
  transaction: Prisma.TransactionClient,
  storeId: number,
  spaceId: number,
  currentSortOrder: number,
  nextSortOrder: number,
): Promise<number> {
  const total = await transaction.space.count({
    where: { storeId },
  });
  const targetSortOrder = normalizeTargetSortOrder(nextSortOrder, total);

  if (targetSortOrder === currentSortOrder) {
    return targetSortOrder;
  }

  if (targetSortOrder < currentSortOrder) {
    await transaction.space.updateMany({
      where: {
        storeId,
        id: { not: spaceId },
        sortOrder: {
          gte: targetSortOrder,
          lt: currentSortOrder,
        },
      },
      data: {
        sortOrder: {
          increment: 1,
        },
      },
    });

    return targetSortOrder;
  }

  await transaction.space.updateMany({
    where: {
      storeId,
      id: { not: spaceId },
      sortOrder: {
        gt: currentSortOrder,
        lte: targetSortOrder,
      },
    },
    data: {
      sortOrder: {
        decrement: 1,
      },
    },
  });

  return targetSortOrder;
}
