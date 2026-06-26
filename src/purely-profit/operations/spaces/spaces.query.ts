import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ListSpacesQueryDto } from './dto/space.dto';
import type { ManagedSpaceRecord, SpaceRemovalCandidate } from './spaces.types';

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

export async function findManagedSpaceOrThrow(
  prisma: PrismaService,
  spaceId: number,
): Promise<ManagedSpaceRecord> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
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
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: {
      id: true,
      storeId: true,
      sortOrder: true,
      _count: {
        select: {
          reservations: {
            where: {
              status: PrismaSpaceReservationStatus.pending,
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
