// 子账号权限矩阵：按角色与业态定义的权限集合（纯数据，无副作用）
import { StoreSubAccountRole } from '@prisma/client';
export const CASHIER_SUB_ACCOUNT_PERMISSIONS = [
  'operation-entry:view',
  'operation-entry:create',
  'goods:view',
  // 空间管理（非餐饮门店收银员专用：查看空间列表/看板、操作会话/预约）
  'space:view',
  // 会员卡（空间管理设置面板入口：持卡与售卡订单只读）。
  // 卡模板属定价与上架配置、手动调次属权益变更，均归 member-card:manage，收银员不持有。
  'member-card:view',
  // 自助下单（查看权限：非餐饮门店收银员需实时接收新订单弹窗，与空间账单可见性对齐）
  'self-ordering:view',
  // 扫码点餐（餐饮门店收银员专用）
  'scan-ordering:view',
  'scan-ordering:table-manage',
  'scan-ordering:order-process',
  // 服务呼叫（门店员工通用：查看 + 确认响应/完成）
  'service-call:view',
  'service-call:process',
  'handover:view',
  'handover:create',
  'handover:update',
  // 客存（餐饮门店收银员专用：查看台账、发起存入、核销取出）
  'custody:view',
  'custody:create',
  'custody:pickup',
] as const;

export const CATERING_MANAGER_SUB_ACCOUNT_PERMISSIONS = [
  // 员工管理
  'staff:view',
  'staff:create',
  'staff:update',
  // 报表（主账号专属，子账号不实际使用）
  'report:view',
  // 商品与供应商管理
  'goods:view',
  'goods:create',
  'goods:update',
  'supplier:view',
  'supplier:create',
  'supplier:update',
  // 进货管理
  'purchase:view',
  'purchase:create',
  // 成本与运营入口
  'cost:view',
  'operation-entry:view',
  'operation-entry:create',
  'operation-entry:delete',
  // 销售记录
  'sales:view',
  'sales:create',
  'sales:delete',
  // 库存管理
  'inventory:view',
  'inventory:update',
  // 扫码点餐（餐饮门店店长专用）
  'scan-ordering:view',
  'scan-ordering:table-manage',
  'scan-ordering:table-config',
  'scan-ordering:order-process',
  // 服务呼叫（门店员工通用：查看 + 确认响应/完成）
  'service-call:view',
  'service-call:process',
  // 交班管理
  'handover:view',
  'handover:create',
  'handover:update',
  // 营销中心读写：店长可操作其它子页面；6 项禁止（会员等级/优惠活动/微信收款配置/
  // 退款/两种充值）由 SubAccountBlockGuard 与前端硬锁收紧，不依赖权限码。
  'marketing:view',
  'marketing:manage',
  // 客存（餐饮门店店长专用：含门店口径配置与作废）
  'custody:view',
  'custody:create',
  'custody:pickup',
  'custody:void',
  'custody:manage',
] as const;

export const GENERAL_MANAGER_SUB_ACCOUNT_PERMISSIONS = [
  // 员工管理
  'staff:view',
  'staff:create',
  'staff:update',
  // 报表（主账号专属，子账号不实际使用）
  'report:view',
  // 商品与供应商管理
  'goods:view',
  'goods:create',
  'goods:update',
  'supplier:view',
  'supplier:create',
  'supplier:update',
  // 进货管理
  'purchase:view',
  'purchase:create',
  // 成本与运营入口
  'cost:view',
  'operation-entry:view',
  'operation-entry:create',
  'operation-entry:delete',
  // 销售记录
  'sales:view',
  'sales:create',
  'sales:delete',
  // 库存管理
  'inventory:view',
  'inventory:update',
  // 空间管理（非餐饮门店店长专用）
  'space:view',
  'space:create',
  'space:update',
  'space:delete',
  // 会员卡（空间管理设置面板入口：持卡/售卡订单只读 + 卡模板维护与手动调次）
  'member-card:view',
  'member-card:manage',
  // 服务人员提成（配置与明细，非餐饮门店店长专用）
  'commission:view',
  'commission:manage',
  // 服务呼叫（门店员工通用：查看 + 确认响应/完成）
  'service-call:view',
  'service-call:process',
  // 自助下单（非餐饮门店店长专用）
  'self-ordering:view',
  'self-ordering:menu-manage',
  'self-ordering:order-process',
  // 交班管理
  'handover:view',
  'handover:create',
  'handover:update',
  // 营销中心读写：店长可操作其它子页面；6 项禁止（会员等级/优惠活动/微信收款配置/
  // 退款/两种充值）由 SubAccountBlockGuard 与前端硬锁收紧，不依赖权限码。
  'marketing:view',
  'marketing:manage',
  // 客存（非餐饮门店店长专用：含门店口径配置与作废）
  'custody:view',
  'custody:create',
  'custody:pickup',
  'custody:void',
  'custody:manage',
] as const;

export const FINANCE_SUB_ACCOUNT_PERMISSIONS = [
  'finance:view',
  'finance:manage',
  'finance:export',
  'report:view',
  'goods:view',
  'inventory:view',
  'inventory:update',
  'supplier:view',
  'supplier:create',
  'supplier:update',
  'purchase:view',
  'purchase:create',
  'cost:view',
  'cost:create',
  'cost:delete',
  'sales:view',
  'staff:view',
  // 服务呼叫（门店员工通用：查看 + 确认响应/完成）
  'service-call:view',
  'service-call:process',
  // 交班管理：财务仅保留只读查看（交班记录审计：可查看、可打印、可导出），
  // 不参与任何交班事务（创建/确认/取消均无权限，附加项管理入口不显示）
  'handover:view',
] as const;

export const SUB_ACCOUNT_ROLE_PERMISSIONS: Record<
  StoreSubAccountRole,
  | readonly string[]
  | ((businessMode?: 'catering' | 'general') => readonly string[])
> = {
  [StoreSubAccountRole.cashier]: CASHIER_SUB_ACCOUNT_PERMISSIONS,
  [StoreSubAccountRole.finance]: FINANCE_SUB_ACCOUNT_PERMISSIONS,
  [StoreSubAccountRole.manager]: (
    businessMode?: 'catering' | 'general',
  ): readonly string[] => {
    // 餐饮店长使用扫码点餐权限集合
    if (businessMode === 'catering') {
      return CATERING_MANAGER_SUB_ACCOUNT_PERMISSIONS;
    }
    // 非餐饮店长使用空间管理权限集合
    return GENERAL_MANAGER_SUB_ACCOUNT_PERMISSIONS;
  },
};
