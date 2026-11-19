import type { ProfitHomeModule } from '../../access-control/subject-capability.service';

/**
 * 首页动态流按「当前角色可进入的首页模块」裁剪。
 *
 * 概览缓存是门店级共享的（同一门店所有角色命中同一份 Redis），因此裁剪只能
 * 发生在缓存读取之后、响应返回之前：缓存里始终保留门店级的完整数据，
 * 每次请求再按当前登录身份过滤，避免把某个角色的视图写回门店缓存。
 *
 * 口径说明：
 * - 只有「专业模块」动态需要模块授权：账款、员工工资/请假、库存/客存、
 *   营销活动、提现审批、经营分析。
 * - 销售、订单、会员新增/充值、空间预约属于首页基础经营数据（首页统计本身
 *   已向具备首页访问权的角色展示销售额与利润），不再额外要求模块授权，
 *   否则收银员首页会被清空。
 * - 未登记的 bizType 一律保留，避免新增动态时因漏配而被静默隐藏。
 */
const ACTIVITY_REQUIRED_MODULE: Record<string, ProfitHomeModule> = {
  finance_account: 'finance-center',
  finance_account_upcoming: 'finance-center',
  // 合伙人提现审批挂在会员中心，收银员与店长默认都不应看到待审金额
  withdrawal: 'member-center',
  employee_payroll: 'staff-management',
  employee_leave: 'staff-management',
  marketing_promotion: 'marketing-center',
  inventory: 'goods-management',
  custody_expiring: 'goods-management',
  revenue_decline: 'business-analysis',
};

export function filterDashboardHomeActivitiesByModules<
  T extends { bizType?: string },
>(
  activities: readonly T[],
  allowedHomeModules: readonly ProfitHomeModule[],
): T[] {
  const allowed = new Set<ProfitHomeModule>(allowedHomeModules);

  return activities.filter((activity) => {
    const requiredModule = activity.bizType
      ? ACTIVITY_REQUIRED_MODULE[activity.bizType]
      : undefined;

    return requiredModule === undefined || allowed.has(requiredModule);
  });
}
