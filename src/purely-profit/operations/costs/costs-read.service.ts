import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  subtractMoneyValues,
  toDecimalNumber,
} from '../../commerce/commerce.utils';
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

    const total = toDecimalNumber(currentAggregate._sum.amount ?? 0);
    const fixed = toDecimalNumber(
      currentTypeRows.find((record) => record.type === 'fixed')?._sum.amount ??
        0,
    );
    const variable = toDecimalNumber(
      currentTypeRows.find((record) => record.type === 'variable')?._sum
        .amount ?? 0,
    );
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
        variable: subtractMoneyValues(total, fixed),
        recordCount: costRows.length,
        compareLastPeriod: calculateCostCompareLastPeriod(
          total,
          toDecimalNumber(previousTotal),
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
      toDecimalNumber(previousAggregate._sum.amount ?? 0),
    );
  }
}
