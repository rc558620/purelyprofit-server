import { getShanghaiDayStartMs } from '../../shared/shanghai-time.utils';
import { Money } from '../../shared/money.utils';
import {
  ONLINE_TREND_HOURS,
  UNKNOWN_REGION_LABEL,
} from './dashboard.constants';
import { calculatePercentChange } from './dashboard-math.utils';
import { normalizeRegionValues } from './dashboard-revenue.utils';
import { DAY_MS, HOUR_MS } from './dashboard-time.utils';
import type { DashboardPartnerTopRow } from './dashboard.types';
import type { PulseHomePromoSummary } from './dashboard-home.query';
import type {
  PulseDashboardOnlineStatsDto,
  PulseDashboardPartnerStatsDto,
  PulseDashboardPartnerTopItemDto,
} from './dto/pulse-dashboard-home.response.dto';

/**
 * 在线 / 活跃统计（真实数据，非模拟值）。
 *
 * 口径：
 * - `onlineCount`：最近 {@link MEMBER_ONLINE_WINDOW_MS}（10 分钟）内有鉴权请求的账号数（实时在线）
 * - `onlinePeak`：今日各小时「活跃人数」的最大值（未做秒级采样，按小时粒度统计）
 * - `onlineTrend`：最近 {@link ONLINE_TREND_HOURS} 个小时的活跃人数（sparkline）
 * - `onlineChangeRatio`：今日活跃人数较昨日的百分比变化（自然日按上海时区切分）
 */
export function buildOnlineStats(
  onlineCount: number,
  activeAtMsList: number[],
  now: Date,
): PulseDashboardOnlineStatsDto {
  const nowMs = now.getTime();
  const todayStartMs = getShanghaiDayStartMs(nowMs);
  const yesterdayStartMs = todayStartMs - DAY_MS;
  const trendStartMs = nowMs - ONLINE_TREND_HOURS * HOUR_MS;

  const todayActiveCount = activeAtMsList.filter(
    (value) => value >= todayStartMs,
  ).length;
  const yesterdayActiveCount = activeAtMsList.filter(
    (value) => value >= yesterdayStartMs && value < todayStartMs,
  ).length;

  // 今日各小时桶（上海时区自然日）→ 取最大值作为「今日峰值」
  const elapsedTodayHours = Math.min(
    Math.floor((nowMs - todayStartMs) / HOUR_MS) + 1,
    24,
  );
  const todayHourBuckets = new Array<number>(elapsedTodayHours).fill(0);
  for (const activeAtMs of activeAtMsList) {
    if (activeAtMs < todayStartMs) {
      continue;
    }

    const bucketIndex = Math.floor((activeAtMs - todayStartMs) / HOUR_MS);
    if (bucketIndex >= 0 && bucketIndex < elapsedTodayHours) {
      todayHourBuckets[bucketIndex] += 1;
    }
  }

  const onlineTrend = Array.from({ length: ONLINE_TREND_HOURS }, (_, index) => {
    const bucketStartMs = trendStartMs + index * HOUR_MS;
    return activeAtMsList.filter(
      (value) => value >= bucketStartMs && value < bucketStartMs + HOUR_MS,
    ).length;
  });

  return {
    onlineCount,
    onlinePeak: todayHourBuckets.reduce(
      (max, count) => (count > max ? count : max),
      0,
    ),
    onlineChangeRatio:
      calculatePercentChange(todayActiveCount, yesterdayActiveCount, {
        fallback: 0,
      }) ?? 0,
    onlineTrend,
  };
}

export interface BuildPartnerStatsParams {
  totalPartners: number;
  activePartnerCount: number;
  newThisMonthPartners: number;
  promoSummary: PulseHomePromoSummary;
}

export function buildPartnerStats(
  params: BuildPartnerStatsParams,
): PulseDashboardPartnerStatsDto {
  const { totalPartners, activePartnerCount, newThisMonthPartners } = params;
  const totalRevenue = Money.fromDbCents(
    params.promoSummary.totalChargedCents,
  ).toOutputYuan();

  return {
    total: totalPartners,
    newThisMonth: newThisMonthPartners,
    activeRate:
      totalPartners > 0
        ? Math.round((activePartnerCount / totalPartners) * 100)
        : 0,
    totalRevenue,
    totalOrders: params.promoSummary.totalOrders,
    avgPerPartner:
      totalPartners > 0 ? Math.round(totalRevenue / totalPartners) : 0,
  };
}

export function buildPartnerTopList(
  rows: DashboardPartnerTopRow[],
): PulseDashboardPartnerTopItemDto[] {
  return rows.map((partner) => {
    const regionValues = normalizeRegionValues(partner.region);
    return {
      name: partner.name,
      city: regionValues[1] ?? regionValues[0] ?? UNKNOWN_REGION_LABEL,
      orders: partner.orders,
      revenue: Money.fromDbCents(partner.revenue).toOutputYuan(),
    };
  });
}
