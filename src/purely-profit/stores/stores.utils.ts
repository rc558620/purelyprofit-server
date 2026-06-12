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

function normalizeCoordinate(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsedValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue < min || parsedValue > max) {
    return undefined;
  }

  return parsedValue;
}

export function extractStoreCreatePayload(value: unknown): StoreCreatePayload {
  const candidate = value as RawCreateStorePayload;

  return {
    storeName:
      typeof candidate.storeName === 'string' ? candidate.storeName : '',
    storeType:
      typeof candidate.storeType === 'string' ? candidate.storeType : '',
    region: Array.isArray(candidate.region)
      ? candidate.region.filter(
          (item): item is StoreRegionValue =>
            typeof item === 'string' || typeof item === 'number',
        )
      : [],
    address: typeof candidate.address === 'string' ? candidate.address : '',
    storeLogo: normalizeStoreLogo(candidate.storeLogo),
    latitude: normalizeCoordinate(candidate.latitude, -90, 90),
    longitude: normalizeCoordinate(candidate.longitude, -180, 180),
  };
}

export function buildStoreProfileMetadata(
  payload: StoreCreatePayload,
): StoreProfileMetadata {
  return normalizeStoreProfileMetadata({
    storeType: payload.storeType,
    region: payload.region,
    storeLogo: payload.storeLogo,
    latitude: payload.latitude,
    longitude: payload.longitude,
  });
}
