import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildFinanceReportCacheKey,
} from '../../redis/keys';
import {
  buildFinanceOverviewCacheKey,
  type FinanceReportCachePart,
} from './finance.cache-keys';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import type { FinanceOverviewQueryDto } from './dto/finance-overview.query.dto';
import type { FinanceReportQueryDto } from './dto/finance-report.query.dto';
import type { FinanceOverviewResponseDto } from './dto/finance-overview.response.dto';
import type { FinanceReportResponseDto } from './dto/finance-report.response.dto';
import { safeStreamCsvExportAsync } from '../../shared/stream-export.utils';
import { Money } from '../../shared/money.utils';
import {
  FINANCE_REPORT_CSV_HEADERS,
  buildFinanceReportCsvRowStream,
} from './finance-account-report.domain';
import {
  FINANCE_OVERVIEW_CACHE_TTL_SECONDS,
  FINANCE_OVERVIEW_REFRESH_AFTER_MS,
  FINANCE_REPORT_CACHE_TTL_SECONDS,
  FINANCE_REPORT_REFRESH_AFTER_MS,
  FINANCE_REPORT_ROWS_CACHE_TTL_SECONDS,
  FINANCE_REPORT_ROWS_REFRESH_AFTER_MS,
} from './finance.constants';
import {
  buildEmptyOverviewResponse,
  buildFinanceOverviewResponse,
  getCashFlowOverviewBucket,
  makeOverviewTotals,
} from './finance-overview.domain';
import { FinanceAccessService } from './finance-access.service';
import type { FinanceRequestContext } from './finance-access.service';
import { iterateFinanceReportCashFlowRows } from './finance-overview-report.query';
import {
  loadFinanceReportRows,
  loadFinanceReportSummary,
  warmFinanceReportPart,
  type FinanceReportRowsValue,
} from './finance-overview-report.loader';
import {
  queryOverviewCategoryTotals,
  queryOverviewDailyTrend as queryFinanceDailyTrend,
  queryOverviewMonthlyTrend as queryFinanceMonthlyTrend,
} from './finance-overview-totals.query';
import { buildFinanceReportQueryInput } from './finance.mapper';
import type { FinanceReportQueryInput } from './finance.types';
import {
  getFinanceReportRange,
  getOverviewCurrentRange,
  getOverviewPreviousRange,
} from './finance-range.utils';

@Injectable()
export class FinanceOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly financeAccessService: FinanceAccessService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    query: FinanceOverviewQueryDto,
  ): Promise<FinanceOverviewResponseDto> {
    const context = await this.financeAccessService.getFinanceContext(user);
    const period = query.period ?? 'month';
    const scope = context.callerIsSubAccount ? 'sub_account' : 'owner';
    const cacheKey = buildFinanceOverviewCacheKey(
      context.storeId,
      period,
      scope,
    );

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_OVERVIEW_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_OVERVIEW_REFRESH_AFTER_MS,
      loadValue: () => this.buildOverview(context, period),
      refreshValue: () => this.buildOverview(context, period),
    });
  }

  async warmOverviewCache(
    storeId: number,
    period: NonNullable<FinanceOverviewQueryDto['period']> | 'month',
    scope: 'owner' | 'sub_account' = 'owner',
  ): Promise<FinanceOverviewResponseDto> {
    const context = await this.financeAccessService.createContext(
      storeId,
      scope === 'sub_account',
    );
    const cacheKey = buildFinanceOverviewCacheKey(
      context.storeId,
      period,
      scope,
    );
    const data = await this.buildOverview(context, period);
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
    const context = await this.financeAccessService.getFinanceContext(user);
    const reportQuery = buildFinanceReportQueryInput(query);
    if (reportQuery.export) {
      context.assertReportExportEnabled();
    }

    // 导出模式或子账号直接查库，不走缓存
    if (reportQuery.export || context.callerIsSubAccount) {
      return this.buildReport(context, reportQuery);
    }

    return this.getCachedReport(context, reportQuery);
  }

  /**
   * 报表读路径（缓存）：概况与明细行各走一个 key。
   *
   * 拆 key 的动机与一致性边界见 `FINANCE_REPORT_ROWS_CACHE_TTL_SECONDS` 注释：
   * 概况只有 7 个数字，明细行 940 KB 级别，二者共用 TTL 会让概况每次刷新都被
   * 明细行拖着重新序列化。失效仍由 `buildFinanceReportPattern` 一次性覆盖两个 part。
   */
  private async getCachedReport(
    context: FinanceRequestContext,
    reportQuery: FinanceReportQueryInput,
  ): Promise<FinanceReportResponseDto> {
    // 走到这里 callerIsSubAccount 必为 false（子账号上面已提前返回），缓存域固定为 owner
    const cacheQuery = { ...reportQuery, scope: 'owner' as const };
    const summaryKey = buildFinanceReportCacheKey(
      context.storeId,
      cacheQuery,
      'summary',
    );
    const rowsKey = buildFinanceReportCacheKey(
      context.storeId,
      cacheQuery,
      'rows',
    );

    const [summary, rows] = await Promise.all([
      this.refreshableCache.getOrLoadRefreshableJson<
        FinanceReportResponseDto['summary']
      >({
        cacheKey: summaryKey,
        taskKey: buildCacheRefreshTaskKey(summaryKey),
        ttlSeconds: FINANCE_REPORT_CACHE_TTL_SECONDS,
        refreshAfterMs: FINANCE_REPORT_REFRESH_AFTER_MS,
        loadValue: () =>
          loadFinanceReportSummary(this.prisma, context, reportQuery),
        refreshValue: () =>
          loadFinanceReportSummary(this.prisma, context, reportQuery),
      }),
      this.refreshableCache.getOrLoadRefreshableJson<FinanceReportRowsValue>({
        cacheKey: rowsKey,
        taskKey: buildCacheRefreshTaskKey(rowsKey),
        ttlSeconds: FINANCE_REPORT_ROWS_CACHE_TTL_SECONDS,
        refreshAfterMs: FINANCE_REPORT_ROWS_REFRESH_AFTER_MS,
        loadValue: () =>
          loadFinanceReportRows(this.prisma, context, reportQuery),
        refreshValue: () =>
          loadFinanceReportRows(this.prisma, context, reportQuery),
      }),
    ]);

    return {
      summary,
      cashFlowRows: rows.cashFlowRows,
      accountRows: rows.accountRows,
    };
  }

  /**
   * 预热财务报表缓存（供 CachePrewarmCycleService 调用）
   *
   * 按 `part` 只重建对应的一半：rows 的数条明细查询不必为了刷新概况白跑一遍。
   */
  async warmReportCache(
    storeId: number,
    query: Pick<
      FinanceReportQueryDto,
      'period' | 'year' | 'customDate' | 'rangeStartDate' | 'rangeEndDate'
    >,
    scope: 'owner' | 'sub_account' = 'owner',
    part: FinanceReportCachePart = 'summary',
  ): Promise<void> {
    const context = await this.financeAccessService.createContext(
      storeId,
      scope === 'sub_account',
    );

    await warmFinanceReportPart({
      cache: this.refreshableCache,
      prisma: this.prisma,
      context,
      reportQuery: { ...query, export: false },
      part,
    });
  }

  private async buildReport(
    context: FinanceRequestContext,
    reportQuery: FinanceReportQueryInput,
  ): Promise<FinanceReportResponseDto> {
    const [summary, rows] = await Promise.all([
      loadFinanceReportSummary(this.prisma, context, reportQuery),
      loadFinanceReportRows(this.prisma, context, reportQuery),
    ]);

    return {
      summary,
      cashFlowRows: rows.cashFlowRows,
      accountRows: rows.accountRows,
    };
  }

  /**
   * 流式导出财务报表 CSV。
   *
   * 只查导出真正需要的现金流水明细：汇总、上期对比与账款行在 CSV 里没有对应列，
   * 原先复用 getReport 会连带多跑 4 条 SQL（含一次全量账款扫描）。
   *
   * 明细改为 keyset 分批拉取 + 逐行写出：既没有「导出到 5000 行静默截断」的上限，
   * 也不会把全量行一次性读进内存。导出权限门控与页面读取共用同一入口，禁止绕过。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: FinanceReportQueryDto,
  ): Promise<void> {
    const context = await this.financeAccessService.getFinanceContext(user);
    context.assertReportExportEnabled();

    const reportQuery = buildFinanceReportQueryInput(query);
    const range = context.clamp(getFinanceReportRange(reportQuery));

    await safeStreamCsvExportAsync(
      reply,
      'finance-report.csv',
      FINANCE_REPORT_CSV_HEADERS,
      buildFinanceReportCsvRowStream(
        iterateFinanceReportCashFlowRows(this.prisma, {
          storeId: context.storeId,
          range,
        }),
      ),
    );
  }

  private async buildOverview(
    context: FinanceRequestContext,
    period: NonNullable<FinanceOverviewQueryDto['period']> | 'month',
  ): Promise<FinanceOverviewResponseDto> {
    const currentRange = getOverviewCurrentRange(period);
    const previousRange = getOverviewPreviousRange(
      period,
      currentRange.start,
      currentRange.end,
    );
    // 本期 / 上期区间共用同一份会员历史窗口，裁剪为纯内存计算
    const clampedCurrentRange = context.clamp(currentRange);
    const clampedPreviousRange = context.clamp({
      start: previousRange.prevStart,
      end: previousRange.prevEnd,
    });

    if (clampedCurrentRange.empty) {
      return buildEmptyOverviewResponse();
    }

    // year 周期走月聚合查询，其余走日聚合查询，避免前端对浮点金额做 += 累加
    const isYearPeriod = period === 'year';

    const [categoryTotals, trendData] = await Promise.all([
      queryOverviewCategoryTotals(this.prisma, {
        storeId: context.storeId,
        currentStart: clampedCurrentRange.start,
        currentEnd: clampedCurrentRange.end,
        prevStart: clampedPreviousRange.empty
          ? null
          : clampedPreviousRange.start,
        prevEnd: clampedPreviousRange.empty ? null : clampedPreviousRange.end,
      }),
      isYearPeriod
        ? queryFinanceMonthlyTrend(this.prisma, {
            storeId: context.storeId,
            start: clampedCurrentRange.start,
            end: clampedCurrentRange.end,
          })
        : queryFinanceDailyTrend(this.prisma, {
            storeId: context.storeId,
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

    // Build trend maps from aggregated data：时间桶起点由 SQL 直接给出，不再二次换算
    const incomeMap = new Map<number, Money>();
    const expenseMap = new Map<number, Money>();

    for (const row of trendData) {
      const income = Money.fromDbCents(row.income);
      const expense = Money.fromDbCents(row.expense);
      if (income.isPositive()) {
        incomeMap.set(row.periodStart, income);
      }
      if (expense.isPositive()) {
        expenseMap.set(row.periodStart, expense);
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
