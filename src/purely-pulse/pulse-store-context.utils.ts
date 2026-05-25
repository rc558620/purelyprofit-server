import { PULSE_SELECTED_STORE_KEY_PREFIX } from './pulse-store-context.constants';
import type { PulseStoreRow, PulseTargetStoreSummary } from './pulse-store-context.types';

export function buildPulseSelectedStoreKey(userId: number): string {
  return `${PULSE_SELECTED_STORE_KEY_PREFIX}${userId}`;
}

export function mapPulseStoreSummary(
  store: PulseStoreRow,
): PulseTargetStoreSummary {
  return {
    id: store.id,
    name: store.name,
    address: store.address,
    contactPhone: store.contactPhone,
    ownerId: store.ownerId,
    ownerName: store.owner.realName ?? store.owner.name,
  };
}
