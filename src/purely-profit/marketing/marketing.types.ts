import type {
  MarketingCustomerStatus,
  MarketingCustomerTierValue,
  MarketingPointsChangeTypeValue,
  MarketingProductSortValue,
  MarketingPromotionStatus,
} from './marketing.utils';

export interface MarketingCustomerRow {
  id: number;
  storeId: number;
  name: string;
  phone: string | null;
  avatar: string | null;
  tier: MarketingCustomerTierValue;
  balance: number;
  points: number;
  totalSpent: number;
  visitCount: number;
  lastVisitAt: Date | null;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingRechargeRow {
  id: number;
  storeId: number;
  customerId: number;
  customerName: string;
  amount: number;
  giftAmount: number;
  type: string;
  promotionId: number | null;
  promotionName: string | null;
  note: string | null;
  createdAt: Date;
}

export interface MarketingConsumptionRow {
  id: number;
  storeId: number;
  customerId: number;
  customerName: string;
  amount: number;
  balancePaid: number;
  pointsDeducted: number;
  payType: string;
  itemsSummary: string | null;
  promotionId: number | null;
  promotionName: string | null;
  createdAt: Date;
}

export interface MarketingPointsRecordRow {
  id: number;
  storeId: number;
  customerId: number;
  amount: number;
  type: MarketingPointsChangeTypeValue;
  description: string;
  createdAt: Date;
}

export interface MarketingCountRow {
  count: number;
}

export interface MarketingPromotionRow {
  id: number;
  storeId: number;
  name: string;
  type: string;
  description: string;
  params: unknown;
  startAt: Date;
  endAt: Date;
  usageCount: number;
  totalDiscount: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingProductCategoryRow {
  id: number;
  storeId: number;
  name: string;
  icon: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingProductRow {
  id: number;
  storeId: number;
  categoryId: number;
  categoryName: string;
  name: string;
  price: number;
  originalPrice: number | null;
  image: string | null;
  description: string | null;
  durationMinutes: number | null;
  personCount: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketingOverviewTrendPoint {
  date: string;
  amount: number;
}

export interface MarketingOverviewMonthlyTrendPoint {
  label: string;
  amount: number | null;
}

export interface MarketingCustomerListQueryInput {
  storeId: number;
  status?: MarketingCustomerStatus;
  tier?: MarketingCustomerTierValue;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface MarketingRechargeListQueryInput {
  storeId: number;
  customerId?: number;
  startMs?: number;
  endMs?: number;
  page?: number;
  pageSize?: number;
}

export interface MarketingCustomerScopedPageQuery {
  page?: number;
  pageSize?: number;
}

export interface MarketingPointsRecordListQueryInput {
  storeId: number;
  customerId?: number;
  type?: MarketingPointsChangeTypeValue;
  startMs?: number;
  endMs?: number;
  page?: number;
  pageSize?: number;
}

export interface MarketingPromotionListQueryInput {
  storeId: number;
  status?: MarketingPromotionStatus;
  page?: number;
  pageSize?: number;
}

export interface MarketingProductListQueryInput {
  storeId: number;
  categoryId?: number;
  sortBy?: MarketingProductSortValue;
}
