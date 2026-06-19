import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PREPAID_DEDUCTION_PRODUCT_NAME } from '../../commerce/commerce.utils';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildSalesReportCacheKey,
} from '../../../redis/keys';
import { RedisService } from '../../../redis/redis.service';
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

const SALES_REPORT_CACHE_TTL_SECONDS = 60;
const SALES_REPORT_REFRESH_AFTER_MS = 15_000;

@Injectable()
export class SalesRecordReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
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

    const cacheKey = buildSalesReportCacheKey(storeId, {
      scope: callerIsSubAccount ? 'sub_account' : 'owner',
      period: query.period,
      year: query.year,
      customDate:
        query.customDate !== undefined ? String(query.customDate) : undefined,
      rangeStartDate:
        query.rangeStartDate !== undefined
          ? String(query.rangeStartDate)
          : undefined,
      rangeEndDate:
        query.rangeEndDate !== undefined
          ? String(query.rangeEndDate)
          : undefined,
    });

    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SALES_REPORT_CACHE_TTL_SECONDS,
      refreshAfterMs: SALES_REPORT_REFRESH_AFTER_MS,
      loadValue: () => this.buildReport(storeId, callerIsSubAccount, query),
      refreshValue: () => this.buildReport(storeId, false, query),
    });
  }

  private async buildReport(
    storeId: number,
    callerIsSubAccount: boolean,
    query: SalesReportQueryDto,
  ): Promise<SalesReportResponseDto> {
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

    // 从 items 重新聚合 totalQuantity，排除预付抵扣行
    const totalQuantity = orders.reduce(
      (sum, order) =>
        sum +
        order.items
          .filter((item) => item.productName !== PREPAID_DEDUCTION_PRODUCT_NAME)
          .reduce((acc, item) => acc + item.quantity, 0),
      0,
    );
    // 从 items 重新聚合 totalRevenue，排除预付抵扣行
    const totalRevenue = orders
      .reduce((acc, order) => {
        const orderRevenue = order.items
          .filter((item) => item.productName !== PREPAID_DEDUCTION_PRODUCT_NAME)
          .reduce(
            (sum, item) => sum + Number(item.salePrice) * item.quantity,
            0,
          );
        return acc.add(new Decimal(orderRevenue));
      }, new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber();
    const dailySales = aggregateReportRows(orders);
    const orderCount = dailySales.length;

    return {
      summary: {
        totalQuantity,
        totalRevenue,
        orderCount,
        avgOrderValue:
          orderCount > 0
            ? new Decimal(totalRevenue)
                .div(orderCount)
                .toDecimalPlaces(2)
                .toNumber()
            : 0,
      },
      dailySales,
    };
  }
}
