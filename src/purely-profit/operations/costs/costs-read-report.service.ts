import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { Money, calcPercentOfTotal } from '../../../shared/money.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildCostsReportCacheKey,
} from '../../../redis/keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import type { CostReportQueryDto } from './dto/costs-query.dto';
import type { CostReportResponseDto } from './dto/costs-response.dto';
import {
  buildEmptyCostReportResponse,
  buildCostReportRange,
  buildPreviousCostReportRange,
  calculateCostCompareLastPeriod,
  getPayrollCostDate,
  getPayrollCostDateExclusive,
  toPayrollMonth,
} from './costs.domain';
import {
  buildCostReportCategories,
  buildCostReportDetailRows,
} from './costs.mapper';
import { queryCostReportRows } from './costs.query';
import {
  COSTS_REPORT_CACHE_TTL_SECONDS,
  COSTS_REPORT_REFRESH_AFTER_MS,
  resolveCallerIsSubAccount,
} from './costs-read.shared';
import {
  safeStreamCsvExport,
  safeStreamCsvExportAsync,
} from '../../../shared/stream-export.utils';
import {
  formatShanghaiDate,
  formatShanghaiYearMonth,
} from '../../../shared/shanghai-time.utils';
import type { CostReportCategoryFilterValue } from './costs.types';

/** 报表明细日期标签：上海时区 `YYYY/MM/DD`，与预览 `dateLabel` 保持一致 */
function formatReportDateLabel(date: Date): string {
  return formatShanghaiDate(date.getTime()).replace(/-/g, '/');
}

@Injectable()
export class CostsReadReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getReport(
    user: AuthenticatedUser,
    query: CostReportQueryDto,
  ): Promise<CostReportResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店成本报表',
    );

    if (storeId === null) {
      return buildEmptyCostReportResponse();
    }

    const callerIsSubAccount = resolveCallerIsSubAccount(user);
    if (query.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
    }

    // 导出模式或子账号直接查库，不走缓存
    if (query.export || callerIsSubAccount) {
      return this.buildReport(storeId, query);
    }

    const cacheKey = buildCostsReportCacheKey(storeId, query);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: COSTS_REPORT_CACHE_TTL_SECONDS,
      refreshAfterMs: COSTS_REPORT_REFRESH_AFTER_MS,
      loadValue: () => this.buildReport(storeId, query),
      refreshValue: () => this.buildReport(storeId, query),
    });
  }

  /**
   * 预热成本报表缓存（供 CachePrewarmCycleService 调用）
   */
  async warmReportCache(
    storeId: number,
    query: Pick<
      CostReportQueryDto,
      | 'period'
      | 'year'
      | 'customDate'
      | 'rangeStartDate'
      | 'rangeEndDate'
      | 'categoryFilter'
    >,
  ): Promise<CostReportResponseDto> {
    const cacheKey = buildCostsReportCacheKey(storeId, query);
    const data = await this.buildReport(storeId, query);
    await this.refreshableCache.writeRefreshableJson(
      cacheKey,
      data,
      COSTS_REPORT_CACHE_TTL_SECONDS,
      COSTS_REPORT_REFRESH_AFTER_MS,
    );
    return data;
  }

  /**
   * 流式导出成本报表 CSV（全量分批，O(1) 内存占用）。
   *
   * 不再复用 `getReport` 的 `detailRows`：那份明细受单次查询上限（默认 5000 条）
   * 约束，直接映射会把预览的截断结果当成全量导出，用户拿到的文件静默少行。
   * 这里改为按 `(date, createdAt, id)` keyset 分批查库，逐批写入响应。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: CostReportQueryDto,
  ): Promise<void> {
    // CSV 导出与 export=true 走同一门禁，确保付费能力校验不被绕过
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店成本报表',
    );
    const callerIsSubAccount = resolveCallerIsSubAccount(user);

    // 鉴权与范围解析全部放在写响应头之前：此阶段的异常仍能转成 JSON 错误响应
    const range =
      storeId === null
        ? null
        : await this.platformMembershipAccessService.clampHistoryRange(
            storeId,
            buildCostReportRange({
              period: query.period,
              year: query.year,
              customDate: query.customDate,
              rangeStartDate: query.rangeStartDate,
              rangeEndDate: query.rangeEndDate,
            }),
          );

    if (storeId === null || range === null || range.empty) {
      safeStreamCsvExport(
        reply,
        'cost-report.csv',
        CostsReadReportService.REPORT_CSV_HEADERS,
        [],
      );
      return;
    }

    await this.platformMembershipAccessService.ensureReportExportEnabled(
      storeId,
      callerIsSubAccount,
    );

    await safeStreamCsvExportAsync(
      reply,
      'cost-report.csv',
      CostsReadReportService.REPORT_CSV_HEADERS,
      this.iterateReportCsvRows(storeId, range, query.categoryFilter ?? 'all'),
    );
  }

  /** 成本报表 CSV 表头（预览与导出共用同一列定义） */
  private static readonly REPORT_CSV_HEADERS = [
    '标题',
    '金额',
    '发生日期',
    '备注',
  ];

  /** 单批读取行数：兼顾往返次数与单批内存 */
  private static readonly REPORT_CSV_BATCH_SIZE = 1000;

  /**
   * 按 keyset 分批产出 CSV 行。
   *
   * 排序与预览一致（date desc → createdAt desc → id desc），游标取上一批最后一行，
   * 避免 offset 深翻页在大数据量下的性能塌陷。
   */
  private async *iterateReportCsvRows(
    storeId: number,
    range: { start: number; end: number },
    categoryFilter: CostReportCategoryFilterValue,
  ): AsyncGenerator<unknown[]> {
    const batchSize = CostsReadReportService.REPORT_CSV_BATCH_SIZE;
    let cursor: { date: Date; createdAt: Date; id: number } | null = null;

    while (true) {
      const where: Prisma.CostRecordWhereInput = {
        storeId,
        date: { gte: new Date(range.start), lte: new Date(range.end) },
        ...(categoryFilter !== 'all' ? { category: categoryFilter } : {}),
        ...(cursor
          ? {
              OR: [
                { date: { lt: cursor.date } },
                {
                  date: cursor.date,
                  createdAt: { lt: cursor.createdAt },
                },
                {
                  date: cursor.date,
                  createdAt: cursor.createdAt,
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      };

      const rows = await this.prisma.costRecord.findMany({
        where,
        select: {
          id: true,
          title: true,
          amount: true,
          note: true,
          date: true,
          createdAt: true,
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: batchSize,
      });

      if (rows.length === 0) {
        return;
      }

      for (const row of rows) {
        yield this.toReportCsvRow(
          row.title,
          row.amount,
          formatReportDateLabel(row.date),
          row.note,
        );
      }

      if (rows.length < batchSize) {
        break;
      }

      const last = rows[rows.length - 1];
      cursor = { date: last.date, createdAt: last.createdAt, id: last.id };
    }

    // 工资草稿只在「工资」分类下并入明细，与预览口径保持一致；
    // 草稿量级为门店员工数，无需分批。
    if (categoryFilter === 'salary') {
      const drafts = await this.prisma.employeePayroll.findMany({
        where: {
          storeId,
          status: 'draft',
          month: {
            gte: getPayrollCostDate(toPayrollMonth(range.start)),
            lt: getPayrollCostDateExclusive(toPayrollMonth(range.end)),
          },
        },
        select: {
          id: true,
          employeeName: true,
          month: true,
          actualSalary: true,
          note: true,
        },
        orderBy: [{ month: 'desc' }, { id: 'desc' }],
      });

      for (const row of drafts) {
        const monthLabel = formatShanghaiYearMonth(row.month.getTime());
        yield this.toReportCsvRow(
          `[草稿] ${row.employeeName} ${monthLabel} 工资`,
          row.actualSalary,
          monthLabel,
          row.note,
        );
      }
    }
  }

  private toReportCsvRow(
    title: string,
    amountCents: number,
    dateLabel: string,
    note: string | null,
  ): unknown[] {
    return [
      title,
      // \t 前缀强制 Excel/WPS 按文本处理，避免金额/日期类型因列宽不足显示 ####
      `\t${Money.fromDbCents(amountCents).toOutputYuan()}`,
      `\t${dateLabel}`,
      note ?? '',
    ];
  }

  private async buildReport(
    storeId: number,
    query: CostReportQueryDto,
  ): Promise<CostReportResponseDto> {
    const currentRange = buildCostReportRange({
      period: query.period,
      year: query.year,
      customDate: query.customDate,
      rangeStartDate: query.rangeStartDate,
      rangeEndDate: query.rangeEndDate,
    });
    const previousRange = buildPreviousCostReportRange(
      query.period,
      currentRange,
    );
    // B5-fix: 与 stats/dashboard/records 保持一致，报表路径不再为子账号 bypass 历史窗口，
    // 子账号同样受主账号 membership 的 historyDays 约束，避免付费墙被绕过。
    const clampedCurrentRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        currentRange,
      );
    const clampedPreviousRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        previousRange,
      );
    const categoryFilter = query.categoryFilter ?? 'all';

    if (clampedCurrentRange.empty) {
      return buildEmptyCostReportResponse();
    }

    const {
      costRows,
      previousTotal,
      payrollRows,
      currentTotalCents,
      currentCount,
      fixedCents,
      variableCents,
      categoryCents,
      detailTruncated,
    } = await queryCostReportRows(
      this.prisma,
      storeId,
      {
        start: clampedCurrentRange.start,
        end: clampedCurrentRange.end,
      },
      !clampedPreviousRange.empty
        ? {
            start: clampedPreviousRange.start,
            end: clampedPreviousRange.end,
          }
        : null,
      categoryFilter,
    );

    // 汇总口径统一走聚合（已在 queryCostReportRows 内按分类/类型聚合，不受明细截断影响）
    const total = Money.fromDbCents(currentTotalCents).toOutputYuan();
    const fixed = Money.fromDbCents(fixedCents).toOutputYuan();
    const variable = Money.fromDbCents(variableCents).toOutputYuan();

    return {
      summary: {
        total,
        fixed,
        variable,
        fixedPercentage: calcPercentOfTotal(fixed, total),
        recordCount: currentCount,
        compareLastPeriod: calculateCostCompareLastPeriod(
          total,
          Money.fromDbCents(previousTotal).toOutputYuan(),
        ),
      },
      categories: buildCostReportCategories(categoryCents, total),
      detailRows: buildCostReportDetailRows(
        costRows,
        payrollRows,
        categoryFilter,
      ),
      detailTruncated,
    };
  }
}
