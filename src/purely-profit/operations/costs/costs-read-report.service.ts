import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
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
import { safeStreamCsvExport } from '../../../shared/stream-export.utils';

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
   * 流式导出成本报表 CSV，O(1) 内存占用。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: CostReportQueryDto,
  ): Promise<void> {
    // CSV 导出与 export=true 走同一门禁，确保付费能力校验不被绕过
    const report = await this.getReport(user, { ...query, export: true });
    safeStreamCsvExport(
      reply,
      'cost-report.csv',
      ['标题', '金额', '发生日期', '备注'],
      report.detailRows.map((row) => [
        row.title,
        // \t 前缀强制 Excel/WPS 按文本处理，避免金额/日期类型因列宽不足显示 ####
        `\t${row.amount}`,
        `\t${row.dateLabel}`,
        row.note ?? '',
      ]),
    );
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
    };
  }
}
