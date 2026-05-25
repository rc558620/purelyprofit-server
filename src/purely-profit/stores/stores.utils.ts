import {
  normalizeStoreProfileMetadata,
  type StoreProfileMetadata,
  type StoreRegionValue,
} from './dto/store-response.dto';
import type { RawCreateStorePayload, StoreCreatePayload } from './stores.types';

function normalizeStoreLogo(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();
  if (normalizedValue === '' || normalizedValue.startsWith('blob:')) {
    return undefined;
  }

  return normalizedValue;
}

export function extractStoreCreatePayload(value: unknown): StoreCreatePayload {
  const candidate = value as RawCreateStorePayload;

  return {
    storeName: typeof candidate.storeName === 'string' ? candidate.storeName : '',
    storeType: typeof candidate.storeType === 'string' ? candidate.storeType : '',
    region: Array.isArray(candidate.region)
      ? candidate.region.filter(
          (item): item is StoreRegionValue =>
            typeof item === 'string' || typeof item === 'number',
        )
      : [],
    address: typeof candidate.address === 'string' ? candidate.address : '',
    storeLogo: normalizeStoreLogo(candidate.storeLogo),
  };
}

export function buildStoreProfileMetadata(
  payload: StoreCreatePayload,
): StoreProfileMetadata {
  return normalizeStoreProfileMetadata({
    storeType: payload.storeType,
    region: payload.region,
    storeLogo: payload.storeLogo,
  });
}
