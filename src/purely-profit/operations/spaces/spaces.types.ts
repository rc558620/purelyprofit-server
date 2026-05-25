import { SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import type { SpaceWithRelations } from './spaces.mapper';

export interface ManagedSpaceRecord extends SpaceWithRelations {
  storeId: number;
}

export interface SpaceRemovalCandidate {
  id: number;
  storeId: number;
  status: PrismaSpaceStatus;
  sortOrder: number;
  _count: {
    reservations: number;
  };
}

export interface ResolvedCreateSpaceRefs {
  typeId: number;
  zoneId: number | null;
}

export interface ResolvedUpdateSpaceRefs {
  typeId?: number;
  zoneId?: number | null;
}
