import { SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import { toTimestampMs } from '../../commerce/commerce.utils';
import type { SpaceResponseDto } from './dto/space.dto';
import type { SpaceStatusValue } from './spaces.constants';

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
