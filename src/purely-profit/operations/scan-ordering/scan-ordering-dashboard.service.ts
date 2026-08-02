import { Injectable } from '@nestjs/common';
import { ScanOrderPaymentStatus, ScanOrderStatus } from '@prisma/client';
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
    const [
      paidRevenue,
      paidOrderCount,
      pendingOrderCount,
      preparingOrderCount,
      tableGroups,
    ] = await Promise.all([
      this.prisma.scanOrders.aggregate({
        where: {
          storeId,
          paymentStatus: ScanOrderPaymentStatus.paid,
          paidAt: { gte: startOfDay },
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.scanOrders.count({
        where: {
          storeId,
          paymentStatus: ScanOrderPaymentStatus.paid,
          paidAt: { gte: startOfDay },
        },
      }),
      this.prisma.scanOrders.count({
        where: { storeId, status: ScanOrderStatus.pending_acceptance },
      }),
      this.prisma.scanOrders.count({
        where: { storeId, status: ScanOrderStatus.preparing },
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
      tableStatusSummary,
    };
  }
}
