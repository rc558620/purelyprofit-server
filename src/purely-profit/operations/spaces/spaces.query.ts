import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ListSpacesQueryDto } from './dto/space.dto';
import type { ManagedSpaceRecord, SpaceRemovalCandidate } from './spaces.types';
import { getReservationStatusRange } from './space-reservations.shared';

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
  // Note: query.status is now a runtime-derived value; Space table no longer has status field.
  // Status filtering is done in-memory after deriving status from sessions/reservations.
  return {
    storeId,
    deletedAt: null,
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
    where: { storeId, deletedAt: null },
  });
  const targetSortOrder = normalizeTargetSortOrder(nextSortOrder, total);

  if (targetSortOrder === currentSortOrder) {
    return targetSortOrder;
  }

  if (targetSortOrder < currentSortOrder) {
    // BUG-02 fix: FOR UPDATE 锁定受影响范围内的行，消除并发重排导致 sortOrder 重复/间隙的窗口
    await transaction.$queryRaw`
      SELECT id FROM spaces
      WHERE store_id = ${storeId} AND id != ${spaceId}
        AND sort_order >= ${targetSortOrder} AND sort_order < ${currentSortOrder}
      FOR UPDATE
    `;

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

  // BUG-02 fix: FOR UPDATE 锁定受影响范围内的行
  await transaction.$queryRaw`
    SELECT id FROM spaces
    WHERE store_id = ${storeId} AND id != ${spaceId}
      AND sort_order > ${currentSortOrder} AND sort_order <= ${targetSortOrder}
    FOR UPDATE
  `;

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

export async function findManagedSpaceOrThrow(
  prisma: PrismaService,
  spaceId: number,
): Promise<ManagedSpaceRecord> {
  // B1 fix: 软删除空间应等价于"不存在"，与 listSpaces 的 deletedAt: null 口径一致
  const space = await prisma.space.findFirst({
    where: { id: spaceId, deletedAt: null },
    include: SPACE_WITH_RELATIONS_INCLUDE,
  });

  if (!space) {
    throw new NotFoundException('空间不存在');
  }

  return space;
}

export async function findSpaceRemovalCandidateOrThrow(
  prisma: PrismaService,
  spaceId: number,
): Promise<SpaceRemovalCandidate> {
  // B1 fix: 软删除空间不可再次操作，与 listSpaces 的 deletedAt: null 口径一致
  // B-3 fix: 预约计数加 reservedAt 范围，与列表 reserved 状态推导口径统一
  const statusRange = getReservationStatusRange();
  const space = await prisma.space.findFirst({
    where: { id: spaceId, deletedAt: null },
    select: {
      id: true,
      storeId: true,
      sortOrder: true,
      _count: {
        select: {
          reservations: {
            where: {
              status: PrismaSpaceReservationStatus.pending,
              reservedAt: {
                gte: statusRange.start,
                lte: statusRange.end,
              },
            },
          },
          // activeSessions: count of active sessions to determine if space is occupied
          sessions: {
            where: {
              status: PrismaSpaceSessionStatus.active,
            },
          },
        },
      },
    },
  });

  if (!space) {
    throw new NotFoundException('空间不存在');
  }

  return space;
}

export async function ensureSpaceNameUnique(
  prisma: PrismaService,
  params: {
    storeId: number;
    name: string;
    excludeSpaceId?: number;
  },
): Promise<void> {
  const duplicate = await prisma.space.findFirst({
    where: {
      storeId: params.storeId,
      name: params.name,
      deletedAt: null,
      ...(params.excludeSpaceId !== undefined
        ? { id: { not: params.excludeSpaceId } }
        : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new ConflictException('空间名称已存在');
  }
}

export function resolveManagedSpaceSortOrder(
  transaction: Prisma.TransactionClient,
  space: ManagedSpaceRecord,
  nextSortOrder: number | undefined,
): Promise<number | undefined> {
  if (nextSortOrder === undefined) {
    return Promise.resolve(undefined);
  }

  if (nextSortOrder === space.sortOrder) {
    return Promise.resolve(
      normalizeTargetSortOrder(nextSortOrder, space.sortOrder),
    );
  }

  return reorderSpaceSortOrder(
    transaction,
    space.storeId,
    space.id,
    space.sortOrder,
    nextSortOrder,
  );
}

export async function closeSortOrderGapAfterRemove(
  transaction: Prisma.TransactionClient,
  storeId: number,
  removedSortOrder: number,
): Promise<void> {
  // B-8 fix: FOR UPDATE 锁定待搬移行，消除并发删除导致 sortOrder 重复的窗口
  await transaction.$queryRaw`
    SELECT id FROM spaces
    WHERE store_id = ${storeId} AND sort_order > ${removedSortOrder}
    FOR UPDATE
  `;

  await transaction.space.updateMany({
    where: {
      storeId,
      sortOrder: {
        gt: removedSortOrder,
      },
    },
    data: {
      sortOrder: {
        decrement: 1,
      },
    },
  });
}
