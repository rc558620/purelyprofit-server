import type { Prisma } from '@prisma/client';

export type PulseResolveSource = 'requested' | 'selected';

export const PULSE_TARGET_STORE_SELECT = {
  id: true,
  name: true,
  address: true,
  contactPhone: true,
  ownerId: true,
  owner: {
    select: {
      name: true,
      realName: true,
    },
  },
} satisfies Prisma.StoreSelect;

export type PulseStoreRow = Prisma.StoreGetPayload<{
  select: typeof PULSE_TARGET_STORE_SELECT;
}>;

export interface PulseTargetStoreSummary {
  id: number;
  name: string;
  address: string | null;
  contactPhone: string | null;
  ownerId: number;
  ownerName: string | null;
}

export interface PulseResolvedTargetStore {
  store: PulseTargetStoreSummary | null;
  source: PulseResolveSource | null;
}

export interface PulseResolveTargetStoreOptions {
  requestedStoreId?: number;
  persistResolvedSelection?: boolean;
  notFoundMessage?: string;
}
