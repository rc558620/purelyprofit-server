import type { MarketingOverviewDto } from './dto/marketing-response.dto';
import type {
  MarketingOverviewMonthlyTrendPoint,
  MarketingOverviewTrendPoint,
} from './marketing.types';
import {
  formatShanghaiDayLabel,
  getShanghaiDayStartMs,
  getShanghaiYear,
} from '../../shared/shanghai-time.utils';

// ─── 概览趋势构建 ─────────────────────────────────────────────

const OVERVIEW_MONTH_LABELS = Array.from(
  { length: 12 },
  (_, index) => `${index + 1}月`,
);

export function buildOverviewLast30Days(
  dailyTotals: Array<{ date: Date; amount: number }>,
): MarketingOverviewTrendPoint[] {
  // 以上海时区的当日零点为基准建桶，保证与前端展示的自然日一致
  const todayStartMs = getShanghaiDayStartMs(Date.now());
  const rangeStartMs = todayStartMs - 29 * 86400_000;

  const buckets = Array.from({ length: 30 }, (_, index) => {
    return {
      date: formatShanghaiDayLabel(rangeStartMs + index * 86400_000),
      amount: 0,
    } satisfies MarketingOverviewTrendPoint;
  });

  const dailyMap = new Map<number, number>();
  for (const row of dailyTotals) {
    dailyMap.set(getShanghaiDayStartMs(row.date.getTime()), row.amount);
  }

  for (let i = 0; i < buckets.length; i++) {
    buckets[i].amount = dailyMap.get(rangeStartMs + i * 86400_000) ?? 0;
  }

  return buckets;
}

export function buildOverviewMonthlyTrend(
  monthlyTotals: Array<{ year: number; month: number; amount: number }>,
  year: number,
): MarketingOverviewMonthlyTrendPoint[] {
  const monthly = OVERVIEW_MONTH_LABELS.map((label) => ({
    label,
    amount: null as number | null,
  }));

  for (const row of monthlyTotals) {
    if (row.year !== year) {
      continue;
    }
    const monthIndex = row.month - 1;
    if (monthIndex >= 0 && monthIndex < monthly.length) {
      monthly[monthIndex].amount = row.amount;
    }
  }

  return monthly;
}

export function buildEmptyMarketingOverview(): MarketingOverviewDto {
  const currentYear = getShanghaiYear(Date.now());

  return {
    totalBalance: 0,
    totalRecharge: 0,
    todayRecharge: 0,
    thisMonthRecharge: 0,
    rechargeCount: 0,
    activeMemberCount: 0,
    inviteCode: '',
    inviteCodeQrCodeImageUrl: '',
    last30Days: buildOverviewLast30Days([]),
    currentYear,
    thisYearMonthlyTrend: buildOverviewMonthlyTrend([], currentYear),
    lastYearMonthlyTrend: buildOverviewMonthlyTrend([], currentYear - 1),
    wechatPayConfig: { configured: false },
  };
}
