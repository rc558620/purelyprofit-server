import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { Money } from '../../../shared/money.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { isDeductionProductName } from '../../commerce/commerce.utils';
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
import {
safeStreamCsvExport,
} from '../../../shared/stream-export.utils';

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
          .filter((item) => !isDeductionProductName(item.productName))
          .reduce((acc, item) => acc + item.quantity, 0),
      0,
    );
    // 从 items 重新聚合 totalRevenue，排除预付抵扣行
    const totalRevenue = Money.sum(
      orders.flatMap((order) =>
        order.items
          .filter((item) => !isDeductionProductName(item.productName))
          .map((item) => Money.fromDbCents(item.salePrice).multiply(item.quantity)),
      ),
    ).toOutputYuan();
    const dailySales = aggregateReportRows(orders);
    // orderCount 应为原始订单笔数，而非按 (日期+商品) 聚合后的行数
    const orderCount = orders.length;

    return {
      summary: {
        totalQuantity,
        totalRevenue,
        orderCount,
        avgOrderValue:
          orderCount > 0
            ? Money.fromInputYuan(totalRevenue)
                .divide(orderCount)
                .toOutputYuan()
            : 0,
      },
      dailySales,
    };
  }

  /**
   * 流式导出销售报表 CSV，O(1) 内存占用。
   * 先写表头，再逐行写 dailySales 数据。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: SalesReportQueryDto,
  ): Promise<void> {
    const report = await this.getReport(user, query);
    safeStreamCsvExport(
      reply,
      'sales-report.csv',
      ['日期', '商品名称', '销售数量', '销售收入'],
      report.dailySales.map((row) => [
        row.dateLabel,
        row.productName,
        row.quantity,
        row.revenue,
      ]),
    );
  }
}
