import type { SaleAggRow } from './dashboard-aggregator.service';

export interface DashboardStoreSummaryRow {
  id: number;
  name: string;
  address: string | null;
}

export interface DashboardRevenueOrderRow {
  amount: number;
  planId: string;
  createdAt: Date;
}

export interface DashboardPartnerTopRow {
  /** 目标商家门店 ID：名单行作为列表稳定主键，避免同名合伙人被合并 */
  id: number;
  name: string;
  region: unknown;
  orders: number;
  revenue: number;
}

export interface DashboardRevenueDetailOrderRow {
  id: number;
  storeId: number;
  amount: number;
  planId: string;
  planName: string;
  createdAt: Date;
  store: {
    name: string;
    address: string | null;
    owner: {
      name: string | null;
      realName: string | null;
    };
  };
}

export interface DashboardRevenueTypeLabelRow {
  typeLabel: string;
}

export interface DashboardRevenueTypeCountRow {
  planId: string;
  count: number;
}

export interface DashboardTrendSaleRow {
  totalRevenue: number;
  date: Date;
}

export interface DashboardStoreRankContext {
  store: DashboardStoreSummaryRow;
  sales: SaleAggRow;
  totalCost: number;
}

export interface DashboardOverviewCurrentStats {
  totalRevenue: number;
  orderCount: number;
}

export interface DashboardOverviewCompareStats {
  orderCount: number;
}
