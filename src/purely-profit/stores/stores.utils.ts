import {
  normalizeStoreProfileMetadata,
  type StoreProfileMetadata,
  type StoreRegionValue,
} from './dto/store-response.dto';
import type { UpdateStoreDto } from './dto/update-store.dto';
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
    businessMode:
      candidate.businessMode === 'catering' ? 'catering' : 'general',
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
    regionLabels: Array.isArray(candidate.regionLabels)
      ? candidate.regionLabels.filter(
          (item): item is string => typeof item === 'string',
        )
      : undefined,
  };
}

/**
 * 从 UpdateStoreDto 提取更新载荷，仅包含 DTO 中实际传入的字段。
 * 未传入的字段值为 undefined，表示不更新该字段。
 */
export function extractStoreUpdatePayload(dto: UpdateStoreDto): {
  storeName?: string;
  storeType?: string;
  storeRegion?: StoreRegionValue[];
  address?: string;
  storeLogo?: string;
  latitude?: number;
  longitude?: number;
  regionLabels?: string[];
} {
  const result: {
    storeName?: string;
    storeType?: string;
    storeRegion?: StoreRegionValue[];
    address?: string;
    storeLogo?: string;
    latitude?: number;
    longitude?: number;
    regionLabels?: string[];
  } = {};

  if (dto.storeName !== undefined) {
    result.storeName = dto.storeName;
  }
  if (dto.storeType !== undefined) {
    result.storeType = dto.storeType;
  }
  if (dto.storeRegion !== undefined) {
    result.storeRegion = dto.storeRegion.filter(
      (item): item is StoreRegionValue =>
        typeof item === 'string' || typeof item === 'number',
    );
  }
  if (dto.address !== undefined) {
    result.address = dto.address;
  }
  if (dto.storeLogo !== undefined) {
    result.storeLogo = normalizeStoreLogo(dto.storeLogo);
  }
  if (dto.latitude !== undefined) {
    const normalized = normalizeCoordinate(dto.latitude, -90, 90);
    if (normalized !== undefined) {
      result.latitude = normalized;
    }
  }
  if (dto.longitude !== undefined) {
    const normalized = normalizeCoordinate(dto.longitude, -180, 180);
    if (normalized !== undefined) {
      result.longitude = normalized;
    }
  }
  if (dto.regionLabels !== undefined) {
    result.regionLabels = dto.regionLabels.filter(
      (item): item is string => typeof item === 'string',
    );
  }

  return result;
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
    regionLabels: payload.regionLabels,
  });
}

/**
 * 增量合并 metadata：保留 currentMetadata 中的现有值，
 * 仅用 updatePayload 中非 undefined 的字段覆盖。
 */
export function buildStoreProfileMetadataUpdate(
  currentMetadata: StoreProfileMetadata,
  updatePayload: ReturnType<typeof extractStoreUpdatePayload>,
): StoreProfileMetadata {
  return normalizeStoreProfileMetadata({
    storeType:
      updatePayload.storeType !== undefined
        ? updatePayload.storeType
        : currentMetadata.storeType,
    region:
      updatePayload.storeRegion !== undefined
        ? updatePayload.storeRegion
        : currentMetadata.region,
    storeLogo:
      updatePayload.storeLogo !== undefined
        ? updatePayload.storeLogo
        : currentMetadata.storeLogo,
    latitude:
      updatePayload.latitude !== undefined
        ? updatePayload.latitude
        : currentMetadata.latitude,
    longitude:
      updatePayload.longitude !== undefined
        ? updatePayload.longitude
        : currentMetadata.longitude,
    regionLabels:
      updatePayload.regionLabels !== undefined
        ? updatePayload.regionLabels
        : currentMetadata.regionLabels,
  });
}
