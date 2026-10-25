import { resolveProductAccountScopeFromEmail } from '../../purely-profit/auth/auth.utils';
import type { AuthProductScope } from '../../shared/auth/auth-account.types';
import { getShanghaiDayStartMs } from '../../shared/shanghai-time.utils';
import { Money } from '../../shared/money.utils';
import { MEMBER_ONLINE_WINDOW_MS } from '../membership/membership.constants';
import {
  ONLINE_TREND_HOURS,
  UNKNOWN_REGION_LABEL,
} from './dashboard.constants';
import { calculatePercentChange } from './dashboard-math.utils';
import {
  normalizeRegionValues,
  toRevenueAmountDisplay,
} from './dashboard-revenue.utils';
import { DAY_MS, HOUR_MS } from './dashboard-time.utils';
import type { DashboardPartnerTopRow } from './dashboard.types';
import type {
  PulseHomeOnlineActivityRow,
  PulseHomePromoSummary,
} from './dashboard-home.query';
import type {
  PulseDashboardOnlineStatsDto,
  PulseDashboardPartnerStatsDto,
  PulseDashboardPartnerTopItemDto,
} from './dto/pulse-dashboard-home.response.dto';

/**
 * 在线账号归属的产品线（按登录邮箱前缀判定）。
 *
 * 与鉴权链路 `resolveAuthenticatedAccountScope` 同口径：个人端账号用 `club_` 前缀邮箱，
 * 其余（早期 `phone_` / `account_` 前缀、平台运营账号）归入商家端，
 * 保证「商家端 + 个人端 = 合计」三数闭合。
 */
const resolveOnlineProductScope = (email: string): AuthProductScope =>
  resolveProductAccountScopeFromEmail(email) ?? 'purely_profit';

/**
 * 在线 / 活跃统计（真实数据，非模拟值）。
 *
 * 口径：
 * - `profitOnlineCount` / `clubOnlineCount`：最近 {@link MEMBER_ONLINE_WINDOW_MS}（10 分钟）内
 *   有鉴权请求、且归属对应产品线（商家端 / 个人端）的账号数
 * - `onlineCount`：两端之和，即实时在线总人数
 * - `onlinePeak`：今日各小时「活跃人数」的最大值（未做秒级采样，按小时粒度统计）
 * - `onlineTrend`：最近 {@link ONLINE_TREND_HOURS} 个小时的活跃人数（sparkline）
 * - `onlineChangeRatio`：今日活跃人数较「昨日同一截断时刻」的百分比变化；
 *   昨日窗口必须按今日已流逝时长截断到同一时刻，否则半天对全天会让环比系统性偏低
 */
export function buildOnlineStats(
  rows: PulseHomeOnlineActivityRow[],
  now: Date,
): PulseDashboardOnlineStatsDto {
  const nowMs = now.getTime();
  const todayStartMs = getShanghaiDayStartMs(nowMs);
  const yesterdayStartMs = todayStartMs - DAY_MS;
  const trendStartMs = nowMs - ONLINE_TREND_HOURS * HOUR_MS;
  const onlineWindowStartMs = nowMs - MEMBER_ONLINE_WINDOW_MS;

  // 实时在线数按产品线拆分：只统计落在 10 分钟窗口内的账号
  let profitOnlineCount = 0;
  let clubOnlineCount = 0;
  for (const row of rows) {
    if (row.lastActiveAtMs < onlineWindowStartMs) {
      continue;
    }

    if (resolveOnlineProductScope(row.email) === 'purely_club') {
      clubOnlineCount += 1;
    } else {
      profitOnlineCount += 1;
    }
  }

  // 昨日对比窗口按「今日已流逝时长」截断，保证与今日同一时刻口径可比
  const elapsedTodayMs = nowMs - todayStartMs;
  const yesterdayCompareStartMs = yesterdayStartMs;
  const yesterdayCompareEndMs = yesterdayStartMs + elapsedTodayMs;
  const activeAtMsList = rows.map((row) => row.lastActiveAtMs);
  const todayActiveCount = activeAtMsList.filter(
    (value) => value >= todayStartMs && value <= nowMs,
  ).length;
  const yesterdayActiveCount = activeAtMsList.filter(
    (value) =>
      value >= yesterdayCompareStartMs && value < yesterdayCompareEndMs,
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
    onlineCount: profitOnlineCount + clubOnlineCount,
    profitOnlineCount,
    clubOnlineCount,
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
  const totalRevenueMoney = Money.fromDbCents(
    params.promoSummary.totalChargedCents,
  );
  const totalRevenueCents = totalRevenueMoney.toDbCents();
  // 人均按 Money 分摊到分，避免先转元后被 Math.round 抹掉精度
  const avgPerPartnerMoney =
    totalPartners > 0 ? totalRevenueMoney.divide(totalPartners) : Money.zero();
  const avgPerPartnerCents = avgPerPartnerMoney.toDbCents();

  return {
    total: totalPartners,
    newThisMonth: newThisMonthPartners,
    activeRate:
      totalPartners > 0
        ? Math.round((activePartnerCount / totalPartners) * 100)
        : 0,
    totalRevenue: totalRevenueCents,
    totalRevenueDisplay: toRevenueAmountDisplay(totalRevenueCents),
    totalOrders: params.promoSummary.totalOrders,
    avgPerPartner: avgPerPartnerCents,
    avgPerPartnerDisplay: toRevenueAmountDisplay(avgPerPartnerCents),
  };
}

export function buildPartnerTopList(
  rows: DashboardPartnerTopRow[],
): PulseDashboardPartnerTopItemDto[] {
  return rows.map((partner) => {
    const regionValues = normalizeRegionValues(partner.region);
    const revenueCents = Money.fromDbCents(partner.revenue).toDbCents();
    return {
      id: String(partner.id),
      name: partner.name,
      city: regionValues[1] ?? regionValues[0] ?? UNKNOWN_REGION_LABEL,
      orders: partner.orders,
      revenue: revenueCents,
      revenueDisplay: toRevenueAmountDisplay(revenueCents),
    };
  });
}
