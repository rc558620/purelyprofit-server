import type { Prisma } from '@prisma/client';
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

export interface DashboardPartnerProfileRow {
  name: string;
  region: unknown;
}

export interface DashboardPromoRecordRow {
  inviteeName: string;
  chargedAmount: number | null;
  storeId: number;
  store: {
    partners: DashboardPartnerProfileRow[];
  } | null;
}

export interface DashboardApprovedPartnerRow {
  id: number;
  name: string | null;
  region: unknown;
  joinedAt: Date | null;
  store: {
    membershipPromoRecords: Array<{
      chargedAmount: number | null;
    }>;
  };
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

export interface DashboardTrendSaleRow {
  totalRevenue: Prisma.Decimal | number | string;
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
