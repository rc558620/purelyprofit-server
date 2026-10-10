import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { Money } from '../../../shared/money.utils';
import type { CostRecordStatsQueryDto } from './dto/costs-query.dto';
import {
  buildPreviousCostCalendarRange,
  calculateCostCompareLastPeriod,
  shouldComparePreviousCostPeriod,
} from './costs.domain';

// ── Cache TTL constants ──

export const COSTS_STATS_CACHE_TTL_SECONDS = 60;
export const COSTS_STATS_REFRESH_AFTER_MS = 15_000;
export const COSTS_REPORT_CACHE_TTL_SECONDS = 120;
export const COSTS_REPORT_REFRESH_AFTER_MS = 30_000;
export const COSTS_RECORDS_CACHE_TTL_SECONDS = 30;
export const COSTS_RECORDS_REFRESH_AFTER_MS = 10_000;
export const COSTS_DASHBOARD_CACHE_TTL_SECONDS = 60;
export const COSTS_DASHBOARD_REFRESH_AFTER_MS = 15_000;
/** 上期金额低于该值时百分比会被放大到无意义，直接不展示环比 */
export const MIN_COMPARABLE_PREVIOUS_YUAN = 100;

// ── Caller helpers ──

export function resolveCallerIsSubAccount(user: AuthenticatedUser): boolean {
  return user.currentMembership?.subjectType === 'sub_account';
}

// ── Previous period change (shared by stats & dashboard) ──

export async function calculatePreviousPeriodChange(
  prisma: PrismaService,
  platformMembershipAccessService: PlatformMembershipAccessService,
  storeId: number,
  query: CostRecordStatsQueryDto,
  total: number,
  _callerIsSubAccount: boolean,
): Promise<number | null> {
  if (!shouldComparePreviousCostPeriod(query.period)) {
    return null;
  }

  // B3-fix: 使用日历对齐的「上期」区间，与报表口径一致
  const previousRange = buildPreviousCostCalendarRange(query);
  if (!previousRange) {
    return null;
  }

  const clampedPreviousRange =
    await platformMembershipAccessService.clampHistoryRange(storeId, {
      start: previousRange.gte.getTime(),
      end: previousRange.lte.getTime(),
    });

  if (clampedPreviousRange.empty) {
    return null;
  }

  const previousAggregate = await prisma.costRecord.aggregate({
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

  // 上期样本过小（如月初刚过零点）时百分比会放大到无意义，直接不展示
  const previousYuan = Money.fromDbCents(
    previousAggregate._sum.amount ?? 0,
  ).toOutputYuan();
  if (previousYuan > 0 && previousYuan < MIN_COMPARABLE_PREVIOUS_YUAN) {
    return null;
  }
  return calculateCostCompareLastPeriod(total, previousYuan);
}
