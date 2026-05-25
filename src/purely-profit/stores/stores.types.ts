import type { StoreRegionValue } from './dto/store-response.dto';

export interface RawCreateStorePayload {
  storeName?: unknown;
  storeType?: unknown;
  region?: unknown;
  address?: unknown;
  storeLogo?: unknown;
}

export interface StoreCreatePayload {
  storeName: string;
  storeType: string;
  region: StoreRegionValue[];
  address: string;
  storeLogo?: string;
}
