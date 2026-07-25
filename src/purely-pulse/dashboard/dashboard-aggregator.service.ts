import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import type { TimeRange } from './dashboard-time.utils';

export interface SaleAggRow {
  totalRevenue: number;
  totalProfit: number;
  orderCount: number;
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
      totalRevenue: Money.fromDbCents(
        aggregation._sum.totalRevenue ?? 0,
      ).toOutputYuan(),
      totalProfit: Money.fromDbCents(
        aggregation._sum.totalProfit ?? 0,
      ).toOutputYuan(),
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

    return Money.fromDbCents(aggregation._sum.amount ?? 0).toOutputYuan();
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
        totalRevenue: Money.fromDbCents(
          row._sum.totalRevenue ?? 0,
        ).toOutputYuan(),
        totalProfit: Money.fromDbCents(
          row._sum.totalProfit ?? 0,
        ).toOutputYuan(),
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
      result[row.storeId] = Money.fromDbCents(
        row._sum.amount ?? 0,
      ).toOutputYuan();
      return result;
    }, {});
  }
}
