import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  FinanceOverviewQueryDto,
  FinanceReportQueryDto,
} from './dto/finance-query.dto';
import type {
  FinanceOverviewResponseDto,
  FinanceReportResponseDto,
} from './dto/finance-response.dto';
import { buildFinanceReportResponse } from './finance-account.domain';
import {
  buildEmptyOverviewResponse,
  buildFinanceOverviewResponse,
  getCashFlowOverviewBucket,
  makeOverviewTotals,
} from './finance-overview.domain';
import { FinanceAccessService } from './finance-access.service';
import {
  queryFinanceReportData,
  queryOverviewCashFlowRecords,
} from './finance-overview-report.query';
import type { FinanceReportQueryInput } from './finance.types';
import {
  addMoneyValues,
  getDayStart,
  getFinanceReportRange,
  getOverviewCurrentRange,
  getOverviewPreviousRange,
  getPreviousFinanceReportRange,
  toMoneyNumber,
} from './finance.utils';

@Injectable()
export class FinanceOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly financeAccessService: FinanceAccessService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    query: FinanceOverviewQueryDto,
  ): Promise<FinanceOverviewResponseDto> {
    const storeId = await this.financeAccessService.getFinanceStoreIdOrThrow(user);
    const period = query.period ?? 'month';
    const currentRange = getOverviewCurrentRange(period);
    const previousRange = getOverviewPreviousRange(
      currentRange.start,
      currentRange.end,
    );
    const clampedCurrentRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        currentRange,
      );
    if (clampedCurrentRange.empty) {
      return buildEmptyOverviewResponse();
    }

    const clampedPreviousRange =
      await this.platformMembershipAccessService.clampHistoryRange(storeId, {
        start: previousRange.prevStart,
        end: previousRange.prevEnd,
      });
    const queryStart = clampedPreviousRange.empty
      ? clampedCurrentRange.start
      : Math.max(
          0,
          Math.min(clampedCurrentRange.start, clampedPreviousRange.start),
        );
    const records = await queryOverviewCashFlowRecords(this.prisma, {
      storeId,
      start: queryStart,
      end: clampedCurrentRange.end,
    });

    const currentTotals = makeOverviewTotals();
    const previousTotals = makeOverviewTotals();
    const incomeMap = new Map<number, number>();
    const expenseMap = new Map<number, number>();

    for (const record of records) {
      const amount = toMoneyNumber(record.amount);
      const timestamp = record.date.getTime();
      const bucket = getCashFlowOverviewBucket(record.category);
      if (bucket === null) {
        continue;
      }

      if (
        timestamp >= clampedCurrentRange.start &&
        timestamp <= clampedCurrentRange.end
      ) {
        currentTotals[bucket] = addMoneyValues(currentTotals[bucket], amount);
        const dayStart = getDayStart(timestamp);
        const targetMap =
          bucket === 'sales' || bucket === 'additional'
            ? incomeMap
            : expenseMap;
        targetMap.set(
          dayStart,
          addMoneyValues(targetMap.get(dayStart) ?? 0, amount),
        );
      } else if (
        !clampedPreviousRange.empty &&
        timestamp >= clampedPreviousRange.start &&
        timestamp <= clampedPreviousRange.end
      ) {
        previousTotals[bucket] = addMoneyValues(previousTotals[bucket], amount);
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

  async getReport(
    user: AuthenticatedUser,
    query: FinanceReportQueryDto,
  ): Promise<FinanceReportResponseDto> {
    const storeId = await this.financeAccessService.getFinanceStoreIdOrThrow(user);
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
      );
    }

    const range = getFinanceReportRange(reportQuery);
    const previousRange = getPreviousFinanceReportRange(reportQuery, range);
    const clampedCurrentRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        range,
      );
    const clampedPreviousRange = previousRange
      ? await this.platformMembershipAccessService.clampHistoryRange(
          storeId,
          previousRange,
        )
      : null;

    const reportData = await queryFinanceReportData(this.prisma, {
      storeId,
      currentRange: clampedCurrentRange,
      previousRange: clampedPreviousRange,
    });

    return buildFinanceReportResponse(reportData);
  }

}
