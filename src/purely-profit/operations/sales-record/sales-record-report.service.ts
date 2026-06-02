import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toDecimalNumber } from '../../commerce/commerce.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  SalesReportQueryDto,
  SalesReportResponseDto,
} from './dto/sales-record.dto';
import { aggregateReportRows } from './sales-record.domain';
import { querySaleOrders } from './sales-record.query';
import {
  buildEmptySalesReport,
  buildSalesCurrentRange,
} from './sales-record-read.utils';
import { sumMoney } from './sales-record.utils';

@Injectable()
export class SalesRecordReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getReport(
    user: AuthenticatedUser,
    query: SalesReportQueryDto,
  ): Promise<SalesReportResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店销售报表',
    );

    if (storeId === null) {
      return buildEmptySalesReport();
    }

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    if (query.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
    }

    const range = await this.platformMembershipAccessService.clampHistoryRange(
      storeId,
      buildSalesCurrentRange(query),
      callerIsSubAccount,
    );
    if (range.empty) {
      return buildEmptySalesReport();
    }

    const orders = await querySaleOrders(this.prisma, {
      storeId,
      range: { start: range.start, end: range.end },
    });

    const totalQuantity = orders.reduce(
      (sum, order) => sum + order.totalQuantity,
      0,
    );
    const totalRevenue = sumMoney(orders, (order) =>
      toDecimalNumber(order.totalRevenue),
    );
    const dailySales = aggregateReportRows(orders);
    const orderCount = dailySales.length;

    return {
      summary: {
        totalQuantity,
        totalRevenue,
        orderCount,
        avgOrderValue:
          orderCount > 0 ? Number((totalRevenue / orderCount).toFixed(2)) : 0,
      },
      dailySales,
    };
  }
}
