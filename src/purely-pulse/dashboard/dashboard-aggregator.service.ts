import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import type { TimeRange } from './dashboard-time.utils';

export interface SaleAggRow {
  totalRevenue: number;
  totalProfit: number;
  orderCount: number;
}

function toMoneyNumber(
  value: { toString(): string } | number | string | null | undefined,
): number {
  if (value === null || value === undefined) {
    return 0;
  }

  return new Decimal(
    typeof value === 'number' || typeof value === 'string'
      ? value
      : value.toString(),
  )
    .toDecimalPlaces(2)
    .toNumber();
}

@Injectable()
export class DashboardAggregatorService {
  constructor(private readonly prisma: PrismaService) {}

  async aggregateSales(
    storeIds: number[],
    range: TimeRange,
  ): Promise<SaleAggRow> {
    const aggregation = await this.prisma.saleOrder.aggregate({
      where: {
        storeId: { in: storeIds },
        date: { gte: new Date(range.start), lte: new Date(range.end) },
      },
      _sum: {
        totalRevenue: true,
        totalProfit: true,
      },
      _count: {
        id: true,
      },
    });

    return {
      totalRevenue: toMoneyNumber(aggregation._sum.totalRevenue),
      totalProfit: toMoneyNumber(aggregation._sum.totalProfit),
      orderCount: aggregation._count.id,
    };
  }

  async aggregateCosts(storeIds: number[], range: TimeRange): Promise<number> {
    const aggregation = await this.prisma.costRecord.aggregate({
      where: {
        storeId: { in: storeIds },
        date: { gte: new Date(range.start), lte: new Date(range.end) },
      },
      _sum: {
        amount: true,
      },
    });

    return toMoneyNumber(aggregation._sum.amount);
  }

  async aggregateSalesByStore(
    storeIds: number[],
    range: TimeRange,
  ): Promise<Record<number, SaleAggRow>> {
    const rows = await this.prisma.saleOrder.groupBy({
      by: ['storeId'],
      where: {
        storeId: { in: storeIds },
        date: { gte: new Date(range.start), lte: new Date(range.end) },
      },
      _sum: {
        totalRevenue: true,
        totalProfit: true,
      },
      _count: {
        id: true,
      },
    });

    return rows.reduce<Record<number, SaleAggRow>>((result, row) => {
      result[row.storeId] = {
        totalRevenue: toMoneyNumber(row._sum.totalRevenue),
        totalProfit: toMoneyNumber(row._sum.totalProfit),
        orderCount: row._count.id,
      };
      return result;
    }, {});
  }

  async aggregateCostsByStore(
    storeIds: number[],
    range: TimeRange,
  ): Promise<Record<number, number>> {
    const rows = await this.prisma.costRecord.groupBy({
      by: ['storeId'],
      where: {
        storeId: { in: storeIds },
        date: { gte: new Date(range.start), lte: new Date(range.end) },
      },
      _sum: {
        amount: true,
      },
    });

    return rows.reduce<Record<number, number>>((result, row) => {
      result[row.storeId] = toMoneyNumber(row._sum.amount);
      return result;
    }, {});
  }
}
