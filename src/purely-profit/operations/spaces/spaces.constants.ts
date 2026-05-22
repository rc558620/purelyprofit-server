import { Prisma, SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import { toTimestampMs } from '../../commerce/commerce.utils';
import type { ListSpacesQueryDto, SpaceResponseDto } from './dto/space.dto';

export const SPACE_STATUS_VALUES = [
  'idle',
  'occupied',
  'reserved',
  'cleaning',
] as const;

export const SPACE_RESERVATION_STATUS_VALUES = [
  'pending',
  'fulfilled',
  'cancelled',
] as const;

export const SPACE_SESSION_STATUS_VALUES = ['active', 'settled'] as const;

export const SPACE_BILLING_MODE_VALUES = [
  'timed',
  'items',
  'mixed',
  'countdown',
] as const;

export type SpaceStatusValue = (typeof SPACE_STATUS_VALUES)[number];
export type SpaceReservationStatusValue =
  (typeof SPACE_RESERVATION_STATUS_VALUES)[number];
export type SpaceSessionStatusValue =
  (typeof SPACE_SESSION_STATUS_VALUES)[number];
export type SpaceBillingModeValue = (typeof SPACE_BILLING_MODE_VALUES)[number];

export type SpaceWithRelations = {
  id: number;
  name: string;
  capacity: number | null;
  enableDirtyRoom: boolean;
  autoCheckout: boolean;
  status: PrismaSpaceStatus;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  type: {
    id: number;
    name: string;
  };
  zone: {
    id: number;
    name: string;
  } | null;
};

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

export function toSpaceStatusValue(
  status: PrismaSpaceStatus,
): SpaceStatusValue {
  return status;
}

export function toSpaceResponse(space: SpaceWithRelations): SpaceResponseDto {
  return {
    id: String(space.id),
    name: space.name,
    type: space.type.name,
    ...(space.zone
      ? {
          zone: space.zone.name,
        }
      : {}),
    ...(space.capacity !== null ? { capacity: space.capacity } : {}),
    enableDirtyRoom: space.enableDirtyRoom,
    autoCheckout: space.autoCheckout,
    status: toSpaceStatusValue(space.status),
    sortOrder: space.sortOrder,
    createdAt: toTimestampMs(space.createdAt),
  };
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
