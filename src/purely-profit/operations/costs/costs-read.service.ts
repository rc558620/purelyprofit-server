import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { Money } from '../../../shared/money.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildCostsRecordsCacheKey,
  buildCostsReportCacheKey,
  buildCostsStatsCacheKey,
} from '../../../redis/keys';
import { RedisService } from '../../../redis/redis.service';
import type {
  CostRecordStatsQueryDto,
  CostReportQueryDto,
  ListCostRecordsQueryDto,
} from './dto/costs-query.dto';
import type {
  CostRecordResponseDto,
  CostReportResponseDto,
  CostStatsResponseDto,
} from './dto/costs-response.dto';
import {
  buildEmptyCostReportResponse,
  buildEmptyCostStatsResponse,
  buildCostReportRange,
  buildPreviousCostRange,
  buildPreviousCostReportRange,
  calculateCostCompareLastPeriod,
  shouldComparePreviousCostPeriod,
  sumCostAmounts,
} from './costs.domain';
import {
  buildCostRecordResponse,
  buildCostReportCategories,
  buildCostReportDetailRows,
} from './costs.mapper';
import {
  buildHistoryAwareCostRecordWhere,
  queryCostReportRows,
} from './costs.query';
import {
safeStreamCsvExport,
} from '../../../shared/stream-export.utils';

const COSTS_STATS_CACHE_TTL_SECONDS = 60;
const COSTS_STATS_REFRESH_AFTER_MS = 15_000;
const COSTS_REPORT_CACHE_TTL_SECONDS = 120;
const COSTS_REPORT_REFRESH_AFTER_MS = 30_000;
const COSTS_RECORDS_CACHE_TTL_SECONDS = 30;
const COSTS_RECORDS_REFRESH_AFTER_MS = 10_000;

@Injectable()
export class CostsReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly configService: ConfigService,
  ) {}

  async listRecords(
    user: AuthenticatedUser,
    query: ListCostRecordsQueryDto,
  ): Promise<CostRecordResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      undefined,
      'cost:view',
      '无权查看成本记录',
    );

    if (storeId === null) {
      return [];
    }

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';

    // 子账号直接查库，不走缓存
    if (callerIsSubAccount) {
      return this.buildRecordsList(storeId, query, callerIsSubAccount);
    }

    const cacheKey = buildCostsRecordsCacheKey(storeId, query);
    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: COSTS_RECORDS_CACHE_TTL_SECONDS,
      refreshAfterMs: COSTS_RECORDS_REFRESH_AFTER_MS,
      loadValue: () => this.buildRecordsList(storeId, query, false),
      refreshValue: () => this.buildRecordsList(storeId, query, false),
    });
  }

  private async buildRecordsList(
    storeId: number,
    query: ListCostRecordsQueryDto,
    callerIsSubAccount: boolean,
  ): Promise<CostRecordResponseDto[]> {
    const where = await buildHistoryAwareCostRecordWhere(
      this.platformMembershipAccessService,
      storeId,
      query,
      callerIsSubAccount,
    );
    if (where === null) {
      return [];
    }

    const maxPageSize = this.configService.get<number>('app.maxPageSize', 100);
    const records = await this.prisma.costRecord.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: maxPageSize,
    });

    return records.map(buildCostRecordResponse);
  }

  async getStats(
    user: AuthenticatedUser,
    query: CostRecordStatsQueryDto,
  ): Promise<CostStatsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      undefined,
      'cost:view',
      '无权查看成本统计',
    );

    if (storeId === null) {
      return buildEmptyCostStatsResponse();
    }

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';

    // 子账号直接查库，不走缓存
    if (callerIsSubAccount) {
      return this.buildStats(storeId, query, callerIsSubAccount);
    }

    const cacheKey = buildCostsStatsCacheKey(storeId, query);
    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: COSTS_STATS_CACHE_TTL_SECONDS,
      refreshAfterMs: COSTS_STATS_REFRESH_AFTER_MS,
      loadValue: () => this.buildStats(storeId, query, false),
      refreshValue: () => this.buildStats(storeId, query, false),
    });
  }

  private async buildStats(
    storeId: number,
    query: CostRecordStatsQueryDto,
    callerIsSubAccount: boolean,
  ): Promise<CostStatsResponseDto> {
    const currentWhere = await buildHistoryAwareCostRecordWhere(
      this.platformMembershipAccessService,
      storeId,
      query,
      callerIsSubAccount,
    );
    if (currentWhere === null) {
      return buildEmptyCostStatsResponse();
    }

    const currentAggregate = await this.prisma.costRecord.aggregate({
      where: currentWhere,
      _sum: { amount: true },
      _count: { _all: true },
    });
    const currentTypeRows = await this.prisma.costRecord.groupBy({
      by: ['type'],
      where: currentWhere,
      _sum: { amount: true },
    });

    const total = Money.fromDbCents(
      currentAggregate._sum.amount ?? 0,
    ).toOutputYuan();
    const fixed = Money.fromDbCents(
      currentTypeRows.find((record) => record.type === 'fixed')?._sum.amount ??
        0,
    ).toOutputYuan();
    const variable = Money.fromDbCents(
      currentTypeRows.find((record) => record.type === 'variable')?._sum
        .amount ?? 0,
    ).toOutputYuan();
    const compareLastPeriod = await this.calculatePreviousPeriodChange(
      storeId,
      query,
      total,
      callerIsSubAccount,
    );

    return {
      total,
      fixed,
      variable,
      compareLastPeriod,
      recordCount: currentAggregate._count._all,
    };
  }

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

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    if (query.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
    }

    // 导出模式或子账号直接查库，不走缓存
    if (query.export || callerIsSubAccount) {
      return this.buildReport(storeId, query, callerIsSubAccount);
    }

    const cacheKey = buildCostsReportCacheKey(storeId, query);
    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: COSTS_REPORT_CACHE_TTL_SECONDS,
      refreshAfterMs: COSTS_REPORT_REFRESH_AFTER_MS,
      loadValue: () => this.buildReport(storeId, query, false),
      refreshValue: () => this.buildReport(storeId, query, false),
    });
  }

  /**
   * 预热成本统计缓存（供 CachePrewarmCycleService 调用）
   */
  async warmStatsCache(
    storeId: number,
    query: Pick<
      CostRecordStatsQueryDto,
      'period' | 'typeFilter' | 'customDate' | 'rangeStartDate' | 'rangeEndDate'
    >,
  ): Promise<CostStatsResponseDto> {
    const cacheKey = buildCostsStatsCacheKey(storeId, query);
    const data = await this.buildStats(storeId, query, false);
    await this.redisService.writeRefreshableJson(
      cacheKey,
      data,
      COSTS_STATS_CACHE_TTL_SECONDS,
      COSTS_STATS_REFRESH_AFTER_MS,
    );
    return data;
  }

  /**
   * 预热成本报表缓存（供 CachePrewarmCycleService 调用）
   */
  async warmReportCache(
    storeId: number,
    query: Pick<
      CostReportQueryDto,
      'period' | 'year' | 'customDate' | 'rangeStartDate' | 'rangeEndDate' | 'categoryFilter'
    >,
  ): Promise<CostReportResponseDto> {
    const cacheKey = buildCostsReportCacheKey(storeId, query);
    const data = await this.buildReport(storeId, query, false);
    await this.redisService.writeRefreshableJson(
      cacheKey,
      data,
      COSTS_REPORT_CACHE_TTL_SECONDS,
      COSTS_REPORT_REFRESH_AFTER_MS,
    );
    return data;
  }

  private async buildReport(
    storeId: number,
    query: CostReportQueryDto,
    callerIsSubAccount: boolean,
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
    const clampedCurrentRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        currentRange,
        callerIsSubAccount,
      );
    const clampedPreviousRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        previousRange,
        callerIsSubAccount,
      );
    const categoryFilter = query.categoryFilter ?? 'all';

    if (clampedCurrentRange.empty) {
      return buildEmptyCostReportResponse();
    }

    const { costRows, previousTotal, payrollRows } = await queryCostReportRows(
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

    const total = sumCostAmounts(costRows);
    const fixed = sumCostAmounts(
      costRows.filter((record) => record.type === 'fixed'),
    );

    return {
      summary: {
        total,
        fixed,
        variable: Money.fromInputYuan(total)
          .subtract(Money.fromInputYuan(fixed))
          .toOutputYuan(),
        recordCount: costRows.length,
        compareLastPeriod: calculateCostCompareLastPeriod(
          total,
          Money.fromDbCents(previousTotal).toOutputYuan(),
        ),
      },
      categories: buildCostReportCategories(costRows, total),
      detailRows: buildCostReportDetailRows(
        costRows,
        payrollRows,
        categoryFilter,
      ),
    };
  }

  /**
   * 流式导出成本报表 CSV，O(1) 内存占用。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: CostReportQueryDto,
  ): Promise<void> {
    const report = await this.getReport(user, query);
    safeStreamCsvExport(
      reply,
      'cost-report.csv',
      ['标题', '金额', '发生日期', '备注'],
      report.detailRows.map((row) => [
        row.title,
        row.amount,
        row.dateLabel,
        row.note ?? '',
      ]),
    );
  }

  private async calculatePreviousPeriodChange(
    storeId: number,
    query: CostRecordStatsQueryDto,
    total: number,
    callerIsSubAccount = false,
  ): Promise<number | null> {
    if (!shouldComparePreviousCostPeriod(query.period)) {
      return null;
    }

    const previousRange = buildPreviousCostRange(query);
    if (!previousRange) {
      return null;
    }

    const clampedPreviousRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        {
          start: previousRange.gte.getTime(),
          end: previousRange.lte.getTime(),
        },
        callerIsSubAccount,
      );

    if (clampedPreviousRange.empty) {
      return null;
    }

    const previousAggregate = await this.prisma.costRecord.aggregate({
      where: {
        storeId,
        date: {
          gte: new Date(clampedPreviousRange.start),
          lte: new Date(clampedPreviousRange.end),
        },
        ...(query.typeFilter && query.typeFilter !== 'all'
          ? { type: query.typeFilter }
          : {}),
      },
      _sum: { amount: true },
    });

    return calculateCostCompareLastPeriod(
      total,
      Money.fromDbCents(previousAggregate._sum.amount ?? 0).toOutputYuan(),
    );
  }
}
