import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
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

@Injectable()
export class CostsReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
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

    const where = await buildHistoryAwareCostRecordWhere(
      this.platformMembershipAccessService,
      storeId,
      query,
    );
    if (where === null) {
      return [];
    }

    const records = await this.prisma.costRecord.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
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

    const currentWhere = await buildHistoryAwareCostRecordWhere(
      this.platformMembershipAccessService,
      storeId,
      query,
    );
    if (currentWhere === null) {
      return buildEmptyCostStatsResponse();
    }

    const currentRecords = await this.prisma.costRecord.findMany({
      where: currentWhere,
      select: {
        amount: true,
        type: true,
      },
    });

    const total = sumCostAmounts(currentRecords);
    const fixed = sumCostAmounts(
      currentRecords.filter((record) => record.type === 'fixed'),
    );
    const variable = sumCostAmounts(
      currentRecords.filter((record) => record.type === 'variable'),
    );
    const compareLastPeriod = await this.calculatePreviousPeriodChange(
      storeId,
      query,
      total,
    );

    return {
      total,
      fixed,
      variable,
      compareLastPeriod,
      recordCount: currentRecords.length,
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

    if (query.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
      );
    }

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
      );
    const clampedPreviousRange = previousRange
      ? await this.platformMembershipAccessService.clampHistoryRange(
          storeId,
          previousRange,
        )
      : null;
    const categoryFilter = query.categoryFilter ?? 'all';

    if (clampedCurrentRange.empty) {
      return buildEmptyCostReportResponse();
    }

    const { costRows, previousRows, payrollRows } = await queryCostReportRows(
      this.prisma,
      storeId,
      {
        start: clampedCurrentRange.start,
        end: clampedCurrentRange.end,
      },
      clampedPreviousRange && !clampedPreviousRange.empty
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
        variable: Number((total - fixed).toFixed(2)),
        recordCount: costRows.length,
        compareLastPeriod: calculateCostCompareLastPeriod(
          total,
          sumCostAmounts(previousRows),
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

  private async calculatePreviousPeriodChange(
    storeId: number,
    query: CostRecordStatsQueryDto,
    total: number,
  ): Promise<number | null> {
    if (!shouldComparePreviousCostPeriod(query.period)) {
      return null;
    }

    const previousRange = buildPreviousCostRange(query);
    if (!previousRange) {
      return null;
    }

    const clampedPreviousRange =
      await this.platformMembershipAccessService.clampHistoryRange(storeId, {
        start: previousRange.gte.getTime(),
        end: previousRange.lte.getTime(),
      });

    if (clampedPreviousRange.empty) {
      return null;
    }

    const previousRecords = await this.prisma.costRecord.findMany({
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
      select: { amount: true },
    });

    return calculateCostCompareLastPeriod(
      total,
      sumCostAmounts(previousRecords),
    );
  }
}
