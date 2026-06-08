import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import { buildFinanceOverviewCacheKey } from './finance.cache-keys';
import { RedisService } from '../../redis/redis.service';
import type { FinanceOverviewQueryDto } from './dto/finance-overview.query.dto';
import type { FinanceReportQueryDto } from './dto/finance-report.query.dto';
import type { FinanceOverviewResponseDto } from './dto/finance-overview.response.dto';
import type { FinanceReportResponseDto } from './dto/finance-report.response.dto';
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
  queryOverviewCashFlowRecords,
} from './finance-overview-report.query';
import type { FinanceReportQueryInput } from './finance.types';
import { getDayStart } from './finance-date.utils';
import { addMoneyValues, toMoneyNumber } from './finance-money.utils';
import {
  getFinanceReportRange,
  getOverviewCurrentRange,
  getOverviewPreviousRange,
  getPreviousFinanceReportRange,
} from './finance-range.utils';

const FINANCE_OVERVIEW_CACHE_TTL_SECONDS = 120;
const FINANCE_OVERVIEW_REFRESH_AFTER_MS = 30_000;

@Injectable()
export class FinanceOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
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
    const cacheKey = buildFinanceOverviewCacheKey(storeId, period);

    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: FINANCE_OVERVIEW_CACHE_TTL_SECONDS,
      refreshAfterMs: FINANCE_OVERVIEW_REFRESH_AFTER_MS,
      loadValue: () => this.buildOverview(storeId, period, callerIsSubAccount),
      refreshValue: () => this.buildOverview(storeId, period, false),
    });
  }

  async warmOverviewCache(
    storeId: number,
    period: NonNullable<FinanceOverviewQueryDto['period']> | 'month',
  ): Promise<FinanceOverviewResponseDto> {
    const cacheKey = buildFinanceOverviewCacheKey(storeId, period);
    const data = await this.buildOverview(storeId, period, false);
    await this.redisService.writeRefreshableJson(
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

    const range = getFinanceReportRange(reportQuery);
    const previousRange = getPreviousFinanceReportRange(reportQuery, range);
    const clampedCurrentRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        range,
        callerIsSubAccount,
      );
    const clampedPreviousRange = previousRange
      ? await this.platformMembershipAccessService.clampHistoryRange(
          storeId,
          previousRange,
          callerIsSubAccount,
        )
      : null;

    const reportData = await queryFinanceReportData(this.prisma, {
      storeId,
      currentRange: clampedCurrentRange,
      previousRange: clampedPreviousRange,
    });

    return buildFinanceReportResponse(reportData);
  }

  private async buildOverview(
    storeId: number,
    period: NonNullable<FinanceOverviewQueryDto['period']> | 'month',
    callerIsSubAccount: boolean,
  ): Promise<FinanceOverviewResponseDto> {
    const currentRange = getOverviewCurrentRange(period);
    const previousRange = getOverviewPreviousRange(
      currentRange.start,
      currentRange.end,
    );
    const clampedCurrentRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        currentRange,
        callerIsSubAccount,
      );
    if (clampedCurrentRange.empty) {
      return buildEmptyOverviewResponse();
    }

    const clampedPreviousRange =
      await this.platformMembershipAccessService.clampHistoryRange(
        storeId,
        {
          start: previousRange.prevStart,
          end: previousRange.prevEnd,
        },
        callerIsSubAccount,
      );
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
}
