import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildFinanceReportCacheKey,
} from '../../redis/keys';
import {
  buildFinanceOverviewCacheKey,
  buildFinanceReportPattern,
} from './finance.cache-keys';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import type { FinanceOverviewQueryDto } from './dto/finance-overview.query.dto';
import type { FinanceReportQueryDto } from './dto/finance-report.query.dto';
import type { FinanceOverviewResponseDto } from './dto/finance-overview.response.dto';
import type { FinanceReportResponseDto } from './dto/finance-report.response.dto';
import { safeStreamCsvExport } from '../../shared/stream-export.utils';
import { Money } from '../../shared/money.utils';
import { buildFinanceReportResponse } from './finance-account-report.domain';
import {
  buildEmptyOverviewResponse,
  buildFinanceOverviewResponse,
  getCashFlowOverviewBucket,
  makeOverviewTotals,
} from './finance-overview.domain';
import { FinanceAccessService } from './finance-access.service';
import {
  queryFinanceReportData,
  queryOverviewCategoryTotals,
  queryOverviewDailyTrend as queryFinanceDailyTrend,
  queryOverviewMonthlyTrend as queryFinanceMonthlyTrend,
} from './finance-overview-report.query';
import type { FinanceReportQueryInput } from './finance.types';
import {
  getShanghaiDayStartMs,
  getShanghaiMonthStartMs,
} from './finance-date.utils';
import {
  getFinanceReportRange,
  getOverviewCurrentRange,
  getOverviewPreviousRange,
  getPreviousFinanceReportRange,
} from './finance-range.utils';

const FINANCE_OVERVIEW_CACHE_TTL_SECONDS = 120;
const FINANCE_OVERVIEW_REFRESH_AFTER_MS = 30_000;
const FINANCE_REPORT_CACHE_TTL_SECONDS = 120;
const FINANCE_REPORT_REFRESH_AFTER_MS = 30_000;

@Injectable()
export class FinanceOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly financeAccessService: FinanceAccessService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    query: FinanceOverviewQueryDto,
  ): Promise<FinanceOverviewResponseDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    const period = query.period ?? 'month';
    const scope = callerIsSubAccount ? 'sub_account' : 'owner';
    const cacheKey = buildFinanceOverviewCacheKey(storeId, period, scope);

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_OVERVIEW_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_OVERVIEW_REFRESH_AFTER_MS,
      loadValue: () => this.buildOverview(storeId, period, callerIsSubAccount),
      refreshValue: () =>
        this.buildOverview(storeId, period, callerIsSubAccount),
    });
  }

  async warmOverviewCache(
    storeId: number,
    period: NonNullable<FinanceOverviewQueryDto['period']> | 'month',
    scope: 'owner' | 'sub_account' = 'owner',
  ): Promise<FinanceOverviewResponseDto> {
    const cacheKey = buildFinanceOverviewCacheKey(storeId, period, scope);
    const callerIsSubAccount = scope === 'sub_account';
    const data = await this.buildOverview(storeId, period, callerIsSubAccount);
    await this.refreshableCache.writeRefreshableJson(
      cacheKey,
      data,
      FINANCE_OVERVIEW_CACHE_TTL_SECONDS,
      FINANCE_OVERVIEW_REFRESH_AFTER_MS,
    );
    return data;
  }

  async getReport(
    user: AuthenticatedUser,
    query: FinanceReportQueryDto,
  ): Promise<FinanceReportResponseDto> {
    const storeId =
      await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    const reportQuery: FinanceReportQueryInput = {
      period: query.period,
      year: query.year,
      customDate: query.customDate,
      rangeStartDate: query.rangeStartDate,
      rangeEndDate: query.rangeEndDate,
      export: query.export,
    };
    if (reportQuery.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
    }

    // 导出模式或子账号直接查库，不走缓存
    if (reportQuery.export || callerIsSubAccount) {
      return this.buildReport(storeId, reportQuery, callerIsSubAccount);
    }

    const scope = callerIsSubAccount ? 'sub_account' : 'owner';
    const cacheKey = buildFinanceReportCacheKey(storeId, {
      ...reportQuery,
      scope,
    });
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_REPORT_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_REPORT_REFRESH_AFTER_MS,
      loadValue: () => this.buildReport(storeId, reportQuery, false),
      refreshValue: () => this.buildReport(storeId, reportQuery, false),
    });
  }

  /**
   * 预热财务报表缓存（供 CachePrewarmCycleService 调用）
   */
  async warmReportCache(
    storeId: number,
    query: Pick<
      FinanceReportQueryDto,
      'period' | 'year' | 'customDate' | 'rangeStartDate' | 'rangeEndDate'
    >,
    scope: 'owner' | 'sub_account' = 'owner',
  ): Promise<FinanceReportResponseDto> {
    const cacheKey = buildFinanceReportCacheKey(storeId, { ...query, scope });
    const callerIsSubAccount = scope === 'sub_account';
    const reportQuery: FinanceReportQueryInput = { ...query, export: false };
    const data = await this.buildReport(
      storeId,
      reportQuery,
      callerIsSubAccount,
    );
    await this.refreshableCache.writeRefreshableJson(
      cacheKey,
      data,
      FINANCE_REPORT_CACHE_TTL_SECONDS,
      FINANCE_REPORT_REFRESH_AFTER_MS,
    );
    return data;
  }

  private async buildReport(
    storeId: number,
    reportQuery: FinanceReportQueryInput,
    callerIsSubAccount: boolean,
  ): Promise<FinanceReportResponseDto> {
    const range = getFinanceReportRange(reportQuery);
    const previousRange = getPreviousFinanceReportRange(reportQuery, range);
    const [clampedCurrentRange, clampedPreviousRange] = await Promise.all([
      this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        range,
        callerIsSubAccount,
      ),
      previousRange
        ? this.platformMembershipAccessService.clampHistoryRange(
            storeId,
            previousRange,
            callerIsSubAccount,
          )
        : Promise.resolve(null),
    ]);

    const reportData = await queryFinanceReportData(this.prisma, {
      storeId,
      currentRange: clampedCurrentRange,
      previousRange: clampedPreviousRange,
    });

    return buildFinanceReportResponse(reportData);
  }

  /**
   * 流式导出财务报表 CSV，O(1) 内存占用。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: FinanceReportQueryDto,
  ): Promise<void> {
    const report = await this.getReport(user, query);
    safeStreamCsvExport(
      reply,
      'finance-report.csv',
      ['日期', '标题', '收支方向', '分类', '金额', '支付方式'],
      report.cashFlowRows.map((row) => [
        // \t 前缀强制 Excel/WPS 按文本处理，避免日期/金额类型因列宽不足显示 ####
        `\t${row.dateLabel}`,
        row.title,
        row.direction,
        row.categoryLabel,
        `\t${row.amount}`,
        row.paymentLabel,
      ]),
    );
  }

  private async buildOverview(
    storeId: number,
    period: NonNullable<FinanceOverviewQueryDto['period']> | 'month',
    callerIsSubAccount: boolean,
  ): Promise<FinanceOverviewResponseDto> {
    const currentRange = getOverviewCurrentRange(period);
    const previousRange = getOverviewPreviousRange(
      period,
      currentRange.start,
      currentRange.end,
    );
    const [clampedCurrentRange, clampedPreviousRange] = await Promise.all([
      this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        currentRange,
        callerIsSubAccount,
      ),
      this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        {
          start: previousRange.prevStart,
          end: previousRange.prevEnd,
        },
        callerIsSubAccount,
      ),
    ]);

    if (clampedCurrentRange.empty) {
      return buildEmptyOverviewResponse();
    }

    // year 周期走月聚合查询，其余走日聚合查询，避免前端对浮点金额做 += 累加
    const isYearPeriod = period === 'year';

    const [categoryTotals, trendData] = await Promise.all([
      queryOverviewCategoryTotals(this.prisma, {
        storeId,
        currentStart: clampedCurrentRange.start,
        currentEnd: clampedCurrentRange.end,
        prevStart: clampedPreviousRange.empty
          ? null
          : clampedPreviousRange.start,
        prevEnd: clampedPreviousRange.empty ? null : clampedPreviousRange.end,
      }),
      isYearPeriod
        ? queryFinanceMonthlyTrend(this.prisma, {
            storeId,
            start: clampedCurrentRange.start,
            end: clampedCurrentRange.end,
          })
        : queryFinanceDailyTrend(this.prisma, {
            storeId,
            start: clampedCurrentRange.start,
            end: clampedCurrentRange.end,
          }),
    ]);

    // Build period totals from category aggregates
    const currentTotals = makeOverviewTotals();
    const previousTotals = makeOverviewTotals();

    for (const row of categoryTotals.current) {
      const bucket = getCashFlowOverviewBucket(row.category);
      if (bucket !== null) {
        currentTotals[bucket] = currentTotals[bucket].add(
          Money.fromDbCents(row.amount),
        );
      }
    }

    for (const row of categoryTotals.previous) {
      const bucket = getCashFlowOverviewBucket(row.category);
      if (bucket !== null) {
        previousTotals[bucket] = previousTotals[bucket].add(
          Money.fromDbCents(row.amount),
        );
      }
    }

    // Build trend maps from aggregated data (日聚合用天零点作 key，月聚合用月1号零点作 key)
    const incomeMap = new Map<number, Money>();
    const expenseMap = new Map<number, Money>();

    for (const row of trendData) {
      const periodStart = isYearPeriod
        ? getShanghaiMonthStartMs((row as { month: number }).month)
        : getShanghaiDayStartMs((row as { day: number }).day);
      const income = Money.fromDbCents(row.income);
      const expense = Money.fromDbCents(row.expense);
      if (income.isPositive()) {
        incomeMap.set(periodStart, income);
      }
      if (expense.isPositive()) {
        expenseMap.set(periodStart, expense);
      }
    }

    return buildFinanceOverviewResponse({
      period,
      currentRange: {
        start: clampedCurrentRange.start,
        end: clampedCurrentRange.end,
      },
      currentTotals,
      previousTotals,
      incomeMap,
      expenseMap,
    });
  }
}
