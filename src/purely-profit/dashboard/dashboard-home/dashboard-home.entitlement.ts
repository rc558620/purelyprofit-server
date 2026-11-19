import { ForbiddenException } from '@nestjs/common';
import type { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { DAY_MS } from './dashboard-home.constants';
import { buildCurrentRange } from './dashboard-home.time-range.utils';
import type { DashboardHomePeriodValue } from './dashboard-home.types';

interface PeriodReadableParams {
  storeId: number;
  period: DashboardHomePeriodValue;
  now: number;
  callerIsSubAccount: boolean;
}

/**
 * 校验请求周期是否落在会员套餐允许的历史窗口内。
 *
 * 子账号沿用「无套餐历史限制」口径（与利润列表 / 详情一致）；
 * 今日、本周必然落在任何套餐的窗口内（最短窗口 7 天，自然周最多 7 天），
 * 直接短路，避免高频首页为两个最常用周期多打一次会员档案查询。
 */
export async function assertPeriodReadableByMembership(
  accessService: PlatformMembershipAccessService,
  params: PeriodReadableParams,
): Promise<void> {
  const { storeId, period, now, callerIsSubAccount } = params;

  if (period === 'today' || period === 'week') {
    return;
  }

  const historyWindowStart = await accessService.getHistoryWindowStart(
    storeId,
    callerIsSubAccount,
  );
  if (historyWindowStart === null) {
    return;
  }

  const currentRange = buildCurrentRange(period, now);
  if (currentRange.start >= historyWindowStart) {
    return;
  }

  const allowedDays = Math.max(
    1,
    Math.ceil((now - historyWindowStart) / DAY_MS),
  );
  throw new ForbiddenException(
    `当前会员套餐仅支持查看最近 ${allowedDays} 天数据，请升级会员后查看更早周期`,
  );
}
