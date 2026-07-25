import type { StoreRegionValue } from './dto/store-response.dto';

export interface RawCreateStorePayload {
  storeName?: unknown;
  storeType?: unknown;
  businessMode?: unknown;
  region?: unknown;
  address?: unknown;
  storeLogo?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  regionLabels?: unknown;
}

export interface StoreCreatePayload {
  storeName: string;
  storeType: string;
  businessMode: 'catering' | 'general';
  region: StoreRegionValue[];
  address: string;
  storeLogo?: string;
  latitude?: number;
  longitude?: number;
  regionLabels?: string[];
}
