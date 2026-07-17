import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import { Money } from '../../../shared/money.utils';
import { REVENUE_DECLINE_CONSECUTIVE_DAYS } from './dashboard-home.constants';
import type { BuildDashboardHomeActivitiesParams } from './dashboard-home.types';
import { toTimestamp } from './dashboard-home.format-helpers';

/** 检测营收连续下滑趋势 */
export function detectRevenueDecline(
  dailyRevenueRows: BuildDashboardHomeActivitiesParams['dailyRevenueRows'],
  now: number,
): {
  isDeclining: boolean;
  consecutiveDays: number;
  totalDeclineAmount: number;
} {
  if (dailyRevenueRows.length < 2) {
    return { isDeclining: false, consecutiveDays: 0, totalDeclineAmount: 0 };
  }

  const DAY_MS = 86_400_000;
  const todayDayStart = getShanghaiDayStartMs(now);
  const revenueByDay = new Map<number, number>();

  for (const row of dailyRevenueRows) {
    const dayTs = getShanghaiDayStartMs(toTimestamp(row.bucketAt));
    const revenue = Money.fromDbCents(row.revenue).toOutputYuan();
    revenueByDay.set(dayTs, (revenueByDay.get(dayTs) ?? 0) + revenue);
  }

  // 按时间升序排列（从远到近），逐日比较：今日 < 昨日 即为下滑
  const sortedDays: Array<{ dayTs: number; revenue: number }> = [];
  for (let i = REVENUE_DECLINE_CONSECUTIVE_DAYS; i >= 0; i--) {
    const dayTs = todayDayStart - i * DAY_MS;
    const revenue = revenueByDay.get(dayTs);
    if (revenue !== undefined) {
      sortedDays.push({ dayTs, revenue });
    }
  }

  if (sortedDays.length < 2) {
    return { isDeclining: false, consecutiveDays: 0, totalDeclineAmount: 0 };
  }

  let consecutiveDays = 0;
  let totalDeclineAmount = 0;
  let prevRevenue: number | null = null;

  for (const { revenue } of sortedDays) {
    if (prevRevenue !== null && revenue < prevRevenue) {
      consecutiveDays++;
      totalDeclineAmount += prevRevenue - revenue;
    } else {
      if (consecutiveDays >= REVENUE_DECLINE_CONSECUTIVE_DAYS) {
        break;
      }
      consecutiveDays = 0;
      totalDeclineAmount = 0;
    }

    prevRevenue = revenue;
  }

  return {
    isDeclining: consecutiveDays >= REVENUE_DECLINE_CONSECUTIVE_DAYS,
    consecutiveDays,
    totalDeclineAmount: Money.fromInputYuan(totalDeclineAmount).toOutputYuan(),
  };
}
