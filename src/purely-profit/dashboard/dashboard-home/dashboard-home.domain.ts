import { Money } from '../../../shared/money.utils';
import type {
  AggregatedCostsResult,
  AggregatedSalesResult,
  CostRecordRow,
  SaleOrderRow,
} from './dashboard-home.types';

export function aggregateDashboardHomeSalesByRange(
  saleOrders: SaleOrderRow[],
  start: number,
  end: number,
): AggregatedSalesResult {
  const matchedOrders = filterSaleOrdersByRange(saleOrders, start, end);

  return {
    revenue: sumSaleOrderRevenue(matchedOrders),
    orderCount: countSaleOrders(matchedOrders),
  };
}

export function aggregateDashboardHomeCostsByRange(
  costRecords: CostRecordRow[],
  start: number,
  end: number,
): AggregatedCostsResult {
  return {
    totalCost: sumCostRecordAmount(
      filterCostRecordsByRange(costRecords, start, end),
    ),
  };
}

export function filterSaleOrdersByRange(
  saleOrders: SaleOrderRow[],
  start: number,
  end: number,
): SaleOrderRow[] {
  return saleOrders.filter((row) =>
    isTimestampInRange(row.date.getTime(), start, end),
  );
}

export function filterCostRecordsByRange(
  costRecords: CostRecordRow[],
  start: number,
  end: number,
): CostRecordRow[] {
  return costRecords.filter((row) =>
    isTimestampInRange(row.date.getTime(), start, end),
  );
}

export function sumSaleOrderRevenue(saleOrders: SaleOrderRow[]): number {
  return Money.sum(
    saleOrders.map((row) => Money.fromDbCents(row.totalRevenue)),
  ).toOutputYuan();
}

export function countSaleOrders(saleOrders: SaleOrderRow[]): number {
  return saleOrders.length;
}

export function sumCostRecordAmount(costRecords: CostRecordRow[]): number {
  return Money.sum(
    costRecords.map((row) => Money.fromDbCents(row.amount)),
  ).toOutputYuan();
}

export function isTimestampInRange(
  timestamp: number,
  start: number,
  end: number,
): boolean {
  return timestamp >= start && timestamp <= end;
}
