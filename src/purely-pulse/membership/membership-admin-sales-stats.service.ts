import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  PulseAdminMemberSalesPeriodSummaryDto,
  PulseAdminMemberSalesStatsDto,
} from './dto/pulse-membership-admin-sales-stats.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';

@Injectable()
export class PulseMembershipAdminSalesStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

  /**
   * 获取指定商家的营业详情统计（销售额 + 利润，5 个周期）。
   */
  async getAdminMemberSalesStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberSalesStatsDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('会员不存在');
    }

    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      memberId,
    );
    if (!canAccess) {
      throw new ForbiddenException('暂无权限查看营业数据');
    }

    const storeId = memberId;
    const now = new Date();
    const shanghaiOffset = 8 * 60 * 60_000;
    const shanghaiNow = new Date(now.getTime() + shanghaiOffset);

    const todayStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth(),
        shanghaiNow.getUTCDate(),
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );

    const weekStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth(),
        shanghaiNow.getUTCDate() - shanghaiNow.getUTCDay(),
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );

    const monthStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth(),
        1,
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );

    const yearStart = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear(), 0, 1, 0, 0, 0, 0) - shanghaiOffset,
    );

    const lastYearStart = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear() - 1, 0, 1, 0, 0, 0, 0) -
        shanghaiOffset,
    );
    const lastYearEnd = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear(), 0, 1, 0, 0, 0, 0) - shanghaiOffset,
    );

    // 上一周期（环比）
    const prevTodayStart = new Date(todayStart.getTime() - 24 * 60 * 60_000);
    const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60_000);
    const prevMonthStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth() - 1,
        1,
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );
    const prevYearStart = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear() - 1, 0, 1, 0, 0, 0, 0) -
        shanghaiOffset,
    );
    const prevYearEnd = yearStart;

    const shanghaiOffsetMs = shanghaiOffset;

    const [today, week, month, year, lastYear] = await Promise.all([
      this.buildSalesPeriodSummary(
        storeId,
        'today',
        todayStart,
        now,
        prevTodayStart,
        todayStart,
        'hour',
        shanghaiOffsetMs,
      ),
      this.buildSalesPeriodSummary(
        storeId,
        'week',
        weekStart,
        now,
        prevWeekStart,
        weekStart,
        'day',
        shanghaiOffsetMs,
      ),
      this.buildSalesPeriodSummary(
        storeId,
        'month',
        monthStart,
        now,
        prevMonthStart,
        monthStart,
        'day',
        shanghaiOffsetMs,
      ),
      this.buildSalesPeriodSummary(
        storeId,
        'year',
        yearStart,
        now,
        prevYearStart,
        prevYearEnd,
        'month',
        shanghaiOffsetMs,
      ),
      this.buildSalesPeriodSummary(
        storeId,
        'lastYear',
        lastYearStart,
        lastYearEnd,
        null,
        null,
        'month',
        shanghaiOffsetMs,
      ),
    ]);

    return { today, week, month, year, lastYear };
  }

  /** 将分（整数）格式化为元展示字符串，去除尾随零。 */
  private static fenToDisplay(amountFen: number): string {
    return new Decimal(amountFen)
      .div(100)
      .toDecimalPlaces(2)
      .toString()
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  }

  /** 聚合单个周期的销售汇总 + 数据点。 */
  private async buildSalesPeriodSummary(
    storeId: number,
    period: string,
    currentStart: Date,
    currentEnd: Date,
    previousStart: Date | null,
    previousEnd: Date | null,
    bucketGranularity: 'hour' | 'day' | 'month',
    shanghaiOffsetMs: number,
  ): Promise<PulseAdminMemberSalesPeriodSummaryDto> {
    const shanghaiOffsetSeconds = shanghaiOffsetMs / 1000;
    const granularityMap = {
      hour: 'hour',
      day: 'day',
      month: 'month',
    } as const;
    const granularityText = granularityMap[bucketGranularity];

    // 使用 Prisma.sql 安全地构建 date_trunc 的 text 参数，避免字符串拼接
    //
    // 执行计划说明：
    // - date_trunc 按时间分桶聚合，WHERE store_id + created_at 范围过滤
    // - 预期走 (store_id, created_at) 索引做范围扫描
    // - date_trunc 本身需排序，若数据量大考虑预聚合表
    const [currentRows, previousRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          bucket: Date;
          sales: Prisma.Decimal | null;
          profit: Prisma.Decimal | null;
        }>
      >`
        SELECT
          date_trunc(${granularityText}::text,
            so.date + (${shanghaiOffsetSeconds} * interval '1 second')
          ) - (${shanghaiOffsetSeconds} * interval '1 second') AS bucket,
          COALESCE(SUM(so.total_revenue), 0) AS sales,
          COALESCE(SUM(so.total_profit), 0) AS profit
        FROM sale_orders so
        WHERE so.store_id = ${storeId}
          AND so.date >= ${currentStart}
          AND so.date <= ${currentEnd}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      previousStart && previousEnd
        ? this.prisma.$queryRaw<
            Array<{
              sales: Prisma.Decimal | null;
              profit: Prisma.Decimal | null;
            }>
          >`
            SELECT
              COALESCE(SUM(so.total_revenue), 0) AS sales,
              COALESCE(SUM(so.total_profit), 0) AS profit
            FROM sale_orders so
            WHERE so.store_id = ${storeId}
              AND so.date >= ${previousStart}
              AND so.date <= ${previousEnd}
          `
        : Promise.resolve([{ sales: null, profit: null }]),
    ]);

    const totalSalesFen = currentRows.reduce(
      (sum, r) => sum + Math.round(Number(r.sales ?? 0)),
      0,
    );
    const totalProfitFen = currentRows.reduce(
      (sum, r) => sum + Math.round(Number(r.profit ?? 0)),
      0,
    );

    const prevSales = Number(previousRows[0]?.sales ?? 0);
    const prevProfit = Number(previousRows[0]?.profit ?? 0);

    const salesGrowthPct =
      prevSales > 0
        ? Number((((totalSalesFen - prevSales) / prevSales) * 100).toFixed(2))
        : null;
    const profitGrowthPct =
      prevProfit > 0
        ? Number(
            (((totalProfitFen - prevProfit) / prevProfit) * 100).toFixed(2),
          )
        : null;

    const dataPoints = currentRows.map((row) => {
      const salesFen = Math.round(Number(row.sales ?? 0));
      const profitFen = Math.round(Number(row.profit ?? 0));
      return {
        label: this.formatBucketLabel(
          row.bucket,
          bucketGranularity,
          shanghaiOffsetMs,
        ),
        salesFen,
        profitFen,
        salesDisplay:
          PulseMembershipAdminSalesStatsService.fenToDisplay(salesFen),
        profitDisplay:
          PulseMembershipAdminSalesStatsService.fenToDisplay(profitFen),
      };
    });

    return {
      period,
      totalSalesFen,
      totalProfitFen,
      totalSalesDisplay:
        PulseMembershipAdminSalesStatsService.fenToDisplay(totalSalesFen),
      totalProfitDisplay:
        PulseMembershipAdminSalesStatsService.fenToDisplay(totalProfitFen),
      salesGrowthPct,
      profitGrowthPct,
      dataPoints,
    };
  }

  /** 根据粒度格式化时间桶标签。 */
  private formatBucketLabel(
    bucket: Date,
    granularity: 'hour' | 'day' | 'month',
    shanghaiOffsetMs: number,
  ): string {
    const shanghaiTime = new Date(bucket.getTime() + shanghaiOffsetMs);
    if (granularity === 'hour') {
      return `${String(shanghaiTime.getUTCHours()).padStart(2, '0')}:00`;
    }
    if (granularity === 'day') {
      return `${String(shanghaiTime.getUTCMonth() + 1).padStart(2, '0')}/${String(shanghaiTime.getUTCDate()).padStart(2, '0')}`;
    }
    return `${shanghaiTime.getUTCMonth() + 1}月`;
  }
}
