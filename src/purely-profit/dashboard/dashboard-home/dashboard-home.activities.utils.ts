import { MAX_HOME_ACTIVITY_COUNT } from './dashboard-home.constants';
import type {
  ActivityDraft,
  BuildDashboardHomeActivitiesParams,
} from './dashboard-home.types';
import type { DashboardHomeActivityDto } from './dto/dashboard-home-response.dto';
import {
  appendCoreFinanceMarketingDrafts,
  appendCoreMemberEmployeeDrafts,
  appendCoreSalesAndInventoryDrafts,
} from './dashboard-home.activities.core-drafts';
import {
  appendCustodyExpiringDraft,
  appendDraftPayrollDraft,
  appendInactiveVipDraft,
  appendRecentOrderDrafts,
  appendRevenueDeclineDraft,
  appendTodayNewMemberDraft,
  appendTodayRechargeDraft,
  appendUpcomingAccountDraft,
  appendUpcomingReservationDraft,
} from './dashboard-home.activities.drafts';

// Re-export for backwards compat (used by dashboard-home.sales-trend.utils)
export { toTimestamp } from './dashboard-home.format-helpers';

/**
 * 首页动态编排：按业务优先级收集各类动态草稿，统一按时间倒序截断。
 *
 * 每一类动态的取值与文案在 `dashboard-home.activities.drafts` 中实现，
 * 本函数只负责顺序与最终裁剪，新增动态只需在此追加一行调用。
 */
export function buildDashboardHomeActivities(
  params: BuildDashboardHomeActivitiesParams,
): DashboardHomeActivityDto[] {
  const drafts: ActivityDraft[] = [];
  // 与 meta.generatedAt 同源：动态数据可能来自缓存，用 Date.now() 会与时间基准漂移
  const now = params.now;

  appendCoreSalesAndInventoryDrafts(drafts, params, now);
  appendCoreFinanceMarketingDrafts(drafts, params, now);
  appendCoreMemberEmployeeDrafts(drafts, params, now);

  // ---- 以下为新增 8 类动态 ----

  appendRecentOrderDrafts(drafts, params, now);
  appendTodayNewMemberDraft(drafts, params, now);
  appendTodayRechargeDraft(drafts, params, now);
  appendUpcomingReservationDraft(drafts, params, now);
  appendUpcomingAccountDraft(drafts, params, now);
  appendDraftPayrollDraft(drafts, params, now);
  appendInactiveVipDraft(drafts, params, now);
  appendRevenueDeclineDraft(drafts, params, now);
  appendCustodyExpiringDraft(drafts, params, now);

  return drafts
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_HOME_ACTIVITY_COUNT);
}
