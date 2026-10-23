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
  /**
   * 是否启用会员护理档案：由 storeType 派生（仅「SPA/养生/美容/」模式为 true）。
   * 与 businessMode 同为注册时确定、注册后不可切换的门店档位。
   */
  memberCareEnabled: boolean;
  region: StoreRegionValue[];
  address: string;
  storeLogo?: string;
  latitude?: number;
  longitude?: number;
  regionLabels?: string[];
}
