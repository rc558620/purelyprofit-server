import { buildPaginationMeta } from '../../commerce/commerce.utils';
import type {
  ListSalesRecordsQueryDto,
  SalesRecordListResponseDto,
  SalesReportQueryDto,
  SalesReportResponseDto,
  SalesStatsQueryDto,
  SalesStatsResponseDto,
} from './dto/sales-record.dto';
import {
  buildCurrentRange,
  type SalesRecordQueryInput,
} from './sales-record.utils';

export type SalesReadRangeQuery =
  | ListSalesRecordsQueryDto
  | SalesStatsQueryDto
  | SalesReportQueryDto;

export interface ClampedSalesRange {
  start: number;
  end: number;
  clamped: boolean;
  empty: boolean;
}

export function resolveSalesRecordPeriod(
  query: SalesReadRangeQuery,
): SalesRecordQueryInput['period'] {
  if (query.period) {
    return query.period;
  }
  if (query.rangeStartDate !== undefined || query.rangeEndDate !== undefined) {
    return 'custom_range';
  }
  if (query.customDate !== undefined) {
    return 'custom_month';
  }
  if (query.year !== undefined) {
    return 'year';
  }

  return undefined;
}

export function toSalesRecordQueryInput(
  query: SalesReadRangeQuery,
): SalesRecordQueryInput {
  return {
    storeId: query.storeId,
    period: resolveSalesRecordPeriod(query),
    year: query.year,
    customDate: query.customDate,
    rangeStartDate: query.rangeStartDate,
    rangeEndDate: query.rangeEndDate,
  };
}

export function buildSalesCurrentRange(query: SalesReadRangeQuery): {
  start: number;
  end: number;
} {
  return buildCurrentRange(toSalesRecordQueryInput(query));
}

export function buildEmptySalesListResponse(
  page = 1,
  pageSize = 20,
): SalesRecordListResponseDto {
  return {
    items: [],
    meta: buildPaginationMeta(0, page, pageSize),
    summary: buildEmptySalesStats(),
  };
}

export function buildEmptySalesStats(): SalesStatsResponseDto {
  return {
    totalRevenue: 0,
    totalProfit: 0,
    orderCount: 0,
    avgOrderValue: 0,
    compareLastPeriod: null,
  };
}

export function buildEmptySalesReport(): SalesReportResponseDto {
  return {
    summary: {
      totalQuantity: 0,
      totalRevenue: 0,
      orderCount: 0,
      avgOrderValue: 0,
    },
    dailySales: [],
  };
}
