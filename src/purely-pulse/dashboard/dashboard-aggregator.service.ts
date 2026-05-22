import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
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
    const rows = await this.prisma.saleOrder.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: new Date(range.start), lte: new Date(range.end) },
      },
      select: { totalRevenue: true, totalProfit: true },
    });

    const totalRevenue = rows
      .reduce((acc, r) => acc.plus(r.totalRevenue), new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber();
    const totalProfit = rows
      .reduce((acc, r) => acc.plus(r.totalProfit), new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber();

    return { totalRevenue, totalProfit, orderCount: rows.length };
  }

  async aggregateCosts(storeIds: number[], range: TimeRange): Promise<number> {
    const rows = await this.prisma.costRecord.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: new Date(range.start), lte: new Date(range.end) },
      },
      select: { amount: true },
    });

    return rows
      .reduce((acc, r) => acc.plus(r.amount), new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber();
  }

  async aggregateSalesByStore(
    storeIds: number[],
    range: TimeRange,
  ): Promise<Record<number, SaleAggRow>> {
    const rows = await this.prisma.saleOrder.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: new Date(range.start), lte: new Date(range.end) },
      },
      select: { storeId: true, totalRevenue: true, totalProfit: true },
    });

    const result: Record<number, SaleAggRow> = {};
    for (const row of rows) {
      const sid = row.storeId;
      if (!result[sid]) {
        result[sid] = { totalRevenue: 0, totalProfit: 0, orderCount: 0 };
      }

      result[sid].totalRevenue = new Decimal(result[sid].totalRevenue)
        .plus(row.totalRevenue)
        .toDecimalPlaces(2)
        .toNumber();
      result[sid].totalProfit = new Decimal(result[sid].totalProfit)
        .plus(row.totalProfit)
        .toDecimalPlaces(2)
        .toNumber();
      result[sid].orderCount += 1;
    }

    return result;
  }

  async aggregateCostsByStore(
    storeIds: number[],
    range: TimeRange,
  ): Promise<Record<number, number>> {
    const rows = await this.prisma.costRecord.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: new Date(range.start), lte: new Date(range.end) },
      },
      select: { storeId: true, amount: true },
    });

    const result: Record<number, number> = {};
    for (const row of rows) {
      const sid = row.storeId;
      result[sid] = new Decimal(result[sid] ?? 0)
        .plus(row.amount)
        .toDecimalPlaces(2)
        .toNumber();
    }

    return result;
  }
}
