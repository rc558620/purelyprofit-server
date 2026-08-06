import { Injectable } from '@nestjs/common';
import {
  ScanOrderPaymentStatus,
  ScanOrderStatus,
  ScanOrderingSessionStatus,
} from '@prisma/client';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import {
  formatShanghaiDate,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { ScanOrderingDashboardResponse } from './scan-ordering.types';

/** 商家扫码点餐看板查询服务。 */
@Injectable()
export class ScanOrderingDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async getDashboard(
    user: AuthenticatedUser,
  ): Promise<ScanOrderingDashboardResponse> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看扫码点餐数据',
    );

    const startOfDayMs = getShanghaiDayStartMs(Date.now());
    const startOfDay = new Date(startOfDayMs);
    const startOfNextDay = new Date(startOfDayMs + 24 * 60 * 60 * 1_000);
    const paidTodayWhere = {
      storeId,
      paidAt: { gte: startOfDay, lt: startOfNextDay },
    };
    const activeSessionWhere = {
      status: ScanOrderingSessionStatus.active,
      deletedAt: null,
      expiresAt: { gt: new Date() },
    };
    const currentRoundSessionWhere = {
      OR: [
        activeSessionWhere,
        {
          status: ScanOrderingSessionStatus.left,
          table: { is: { sessions: { some: activeSessionWhere } } },
        },
      ],
    };
    const [
      paidRevenue,
      paidOrderCount,
      pendingOrderCount,
      preparingOrderCount,
      refundingOrderCount,
      tableGroups,
    ] = await Promise.all([
      this.prisma.scanOrders.aggregate({
        where: {
          ...paidTodayWhere,
          paymentStatus: {
            in: [ScanOrderPaymentStatus.paid, ScanOrderPaymentStatus.refunding],
          },
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.scanOrders.count({
        where: {
          storeId,
          createdAt: { gte: startOfDay, lt: startOfNextDay },
        },
      }),
      this.prisma.scanOrders.count({
        where: {
          storeId,
          status: ScanOrderStatus.pending_acceptance,
          session: { is: currentRoundSessionWhere },
        },
      }),
      this.prisma.scanOrders.count({
        where: {
          storeId,
          status: ScanOrderStatus.preparing,
          session: { is: currentRoundSessionWhere },
        },
      }),
      this.prisma.scanOrders.count({
        where: {
          storeId,
          status: ScanOrderStatus.refunding,
          paymentStatus: ScanOrderPaymentStatus.refunding,
          session: { is: currentRoundSessionWhere },
        },
      }),
      this.prisma.scanOrderingTable.groupBy({
        by: ['status'],
        where: { storeId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const tableStatusSummary: ScanOrderingDashboardResponse['tableStatusSummary'] =
      { empty: 0, dining: 0, clearing: 0, disabled: 0 };
    for (const group of tableGroups) {
      tableStatusSummary[group.status] = group._count._all;
    }

    return {
      businessDate: formatShanghaiDate(startOfDayMs),
      paidRevenue: Money.fromDbCents(
        paidRevenue._sum.paidAmount ?? 0,
      ).toOutputYuan(),
      paidOrderCount,
      pendingOrderCount,
      preparingOrderCount,
      refundingOrderCount,
      tableStatusSummary,
    };
  }
}
