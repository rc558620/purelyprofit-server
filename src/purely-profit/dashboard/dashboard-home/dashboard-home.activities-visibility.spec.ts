import type { ProfitHomeModule } from '../../access-control/subject-capability.service';
import { filterDashboardHomeActivitiesByModules } from './dashboard-home.activities-visibility';

const ALL_MODULES: ProfitHomeModule[] = [
  'additional',
  'business-analysis',
  'finance-center',
  'goods-management',
  'handover-management',
  'marketing-center',
  'member-center',
  'space-management',
  'staff-management',
  'store-settings',
];

/** 收银员：只有首页基础模块、空间与交接班 */
const CASHIER_MODULES: ProfitHomeModule[] = [
  'additional',
  'handover-management',
  'space-management',
];

describe('filterDashboardHomeActivitiesByModules', () => {
  it('收银员看不到账款、工资、库存、营销、提现与经营分析动态', () => {
    const activities = [
      { bizType: 'sales' },
      { bizType: 'sales_order' },
      { bizType: 'member_new' },
      { bizType: 'member_recharge' },
      { bizType: 'space_reservation' },
      { bizType: 'finance_account' },
      { bizType: 'finance_account_upcoming' },
      { bizType: 'employee_payroll' },
      { bizType: 'employee_leave' },
      { bizType: 'inventory' },
      { bizType: 'custody_expiring' },
      { bizType: 'marketing_promotion' },
      { bizType: 'withdrawal' },
      { bizType: 'revenue_decline' },
    ];

    const visible = filterDashboardHomeActivitiesByModules(
      activities,
      CASHIER_MODULES,
    );

    expect(visible.map((activity) => activity.bizType)).toEqual([
      'sales',
      'sales_order',
      'member_new',
      'member_recharge',
      'space_reservation',
    ]);
  });

  it('拥有全部首页模块时不裁剪任何动态', () => {
    const activities = [
      { bizType: 'finance_account' },
      { bizType: 'marketing_promotion' },
      { bizType: 'employee_payroll' },
    ];

    expect(filterDashboardHomeActivitiesByModules(activities, ALL_MODULES)).toHaveLength(
      3,
    );
  });

  it('未登记的 bizType 一律保留，避免新增动态被静默隐藏', () => {
    const activities = [{ bizType: 'brand_new_activity' }, {}];

    expect(
      filterDashboardHomeActivitiesByModules(activities, CASHIER_MODULES),
    ).toHaveLength(2);
  });
});
