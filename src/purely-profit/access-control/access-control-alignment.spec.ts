import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  StaffRole,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import {
  ALLOW_LEGACY_OWNER_ACCESS_KEY,
  REQUIRE_PERMISSIONS_KEY,
} from './decorators/require-permissions.decorator';
import {
  AccessControlService,
  type AuthenticatedMembership,
} from './access-control.service';
import { SubjectCapabilityService } from './subject-capability.service';
import { PermissionsGuard } from './guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  MarketingNewCustomerQuotaController,
  MarketingOverviewController,
  MarketingStoreLocationController,
} from '../marketing/marketing.controller';
import { MarketingCustomersController } from '../marketing/marketing-customers.controller';
import { MarketingProductCategoriesController } from '../marketing/marketing-product-categories.controller';
import { MarketingProductsController } from '../marketing/marketing-products.controller';
import { MarketingPromotionsController } from '../marketing/marketing-promotions.controller';
import { SmsController } from '../marketing/sms/sms.controller';
import { MarketingTransactionsController } from '../marketing/marketing-transactions.controller';
import { PartnerReviewController } from '../member/platform-membership/partner-review.controller';
import { PlatformMembershipController } from '../member/platform-membership/platform-membership.controller';
import { PromotionDetailCompatController } from '../member/platform-membership/promotion-detail-compat.controller';
import {
  SalesOrdersCompatController,
  SalesRecordController,
} from '../operations/sales-record/sales-record.controller';
import { SpaceSessionsController } from '../operations/spaces/space-sessions.controller';
import { FinanceController } from '../finance/finance.controller';
import { InventoryController } from '../goods/inventory/inventory.controller';
import { BusinessAnalysisController } from '../dashboard/business-analysis/business-analysis.controller';
import { DashboardHomeController } from '../dashboard/dashboard-home/dashboard-home.controller';
import { EmployeesPayrollsController } from '../staff/employees/employees.controller';
import { StoresController } from '../stores/stores.controller';
import { MemberCardsController } from '../member/cards/member-cards.controller';
import { MemberCardPlansController } from '../member/cards/member-card-plans.controller';
import { MemberCardOrdersController } from '../member/cards/member-card-orders.controller';
import { SubAccountBlockGuard } from './guards/sub-account-block.guard';
import { BLOCK_SUB_ACCOUNT_KEY } from './decorators/block-sub-account.decorator';

const accessControlService = new AccessControlService();
const subjectCapabilityService = new SubjectCapabilityService(
  accessControlService,
);

const buildSubAccountMembership = (
  role: StoreSubAccountRole,
  overrides: Partial<AuthenticatedMembership> = {},
): AuthenticatedMembership => ({
  staffId: 8,
  storeId: 18,
  role: StaffRole.staff,
  permissions: [],
  isActive: true,
  subjectType: 'sub_account',
  linkedEmployeeId: 12,
  subAccountId: 6,
  subAccountRole: role,
  subAccountStatus: StoreSubAccountStatus.active,
  subAccountAssigned: true,
  canAccessHome: true,
  canUseHandover: true,
  ...overrides,
});

describe('Sub-account alignment regression', () => {
  it('cashier 的首页模块与关键接口权限保持一致', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.cashier);
    const permissions =
      accessControlService.getEffectivePermissions(membership);
    const capability = subjectCapabilityService.buildSnapshot(membership, 3);

    expect(capability.allowedHomeModules).toEqual([
      'additional',
      'space-management',
      'handover-management',
    ]);
    expect(capability.canUseGoodsManagement).toBe(false);
    expect(permissions).toEqual([
      'operation-entry:view',
      'operation-entry:create',
      'goods:view',
      'space:view',
      // 会员卡：空间管理设置面板入口，收银员可只读持卡与售卡订单
      'member-card:view',
      'self-ordering:view',
      'scan-ordering:view',
      'scan-ordering:table-manage',
      'scan-ordering:order-process',
      'service-call:view',
      'service-call:process',
      'handover:view',
      'handover:create',
      'handover:update',
      // 客存：收银员可查看台账、发起存入与核销取出
      'custody:view',
      'custody:create',
      'custody:pickup',
    ]);
    expect(permissions).toContain('goods:view');
    expect(permissions).toContain('member-card:view');
    expect(permissions).not.toContain('member-card:manage');
    expect(permissions).not.toContain('sales:view');
    expect(permissions).not.toContain('marketing:view');
    expect(permissions).not.toContain('finance:view');
    expect(permissions).not.toContain('store:view');
    expect(permissions).not.toContain('scan-ordering:table-config');
  });

  it('manager 的首页模块与关键接口权限保持一致', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.manager);
    const permissions =
      accessControlService.getEffectivePermissions(membership);
    const capability = subjectCapabilityService.buildSnapshot(membership, 3);

    expect(capability.allowedHomeModules).toEqual([
      'additional',
      'business-analysis',
      'goods-management',
      'handover-management',
      'marketing-center',
      'space-management',
      'staff-management',
    ]);
    expect(capability.canUseGoodsManagement).toBe(true);
    expect(capability.canViewMarketing).toBe(true);
    expect(permissions).toContain('report:view');
    expect(permissions).toContain('marketing:view');
    // 店长可操作营销中心其它子页面：写权限下放，6 项禁止改由 Guard / 前端硬锁收紧
    expect(permissions).toContain('marketing:manage');
    expect(permissions).toContain('goods:view');
    expect(permissions).toContain('inventory:view');
    expect(permissions).toContain('cost:view');
    expect(permissions).toContain('purchase:view');
    expect(permissions).toContain('sales:view');
    expect(permissions).toContain('staff:view');
    expect(permissions).toContain('member-card:view');
    expect(permissions).toContain('member-card:manage');
    expect(permissions).not.toContain('members:view');
    expect(permissions).not.toContain('partner:view');
    expect(permissions).not.toContain('finance:view');
    expect(permissions).not.toContain('store:view');
  });

  it('finance 的首页模块与关键接口权限保持一致（不参与交班但保留只读查看）', () => {
    // 生产现实：员工分配路径下财务 canUseHandover 恒为 false
    const membership = buildSubAccountMembership(StoreSubAccountRole.finance, {
      canUseHandover: false,
    });
    const permissions =
      accessControlService.getEffectivePermissions(membership);
    const capability = subjectCapabilityService.buildSnapshot(membership, 3);

    expect(capability.allowedHomeModules).toEqual([
      'business-analysis',
      'finance-center',
      'handover-management',
      'staff-management',
    ]);
    expect(capability.allowedHomeModules).not.toContain('goods-management');
    expect(capability.canUseGoodsManagement).toBe(false);
    expect(capability.canUseHandoverManagement).toBe(true);
    expect(permissions).toContain('report:view');
    expect(permissions).toContain('finance:view');
    expect(permissions).toContain('goods:view');
    expect(permissions).toContain('inventory:view');
    expect(permissions).toContain('inventory:update');
    expect(permissions).toContain('cost:view');
    expect(permissions).toContain('cost:create');
    expect(permissions).toContain('cost:delete');
    expect(permissions).toContain('supplier:view');
    expect(permissions).toContain('supplier:create');
    expect(permissions).toContain('supplier:update');
    expect(permissions).toContain('purchase:view');
    expect(permissions).toContain('purchase:create');
    expect(permissions).toContain('sales:view');
    expect(permissions).toContain('staff:view');
    // 财务只读审计：可查看交班记录，但不参与任何交班事务
    expect(permissions).toContain('handover:view');
    expect(permissions).not.toContain('handover:create');
    expect(permissions).not.toContain('handover:update');
    expect(permissions).not.toContain('marketing:view');
    expect(permissions).not.toContain('space:view');
    expect(permissions).not.toContain('operation-entry:view');
    expect(permissions).not.toContain('store:view');
  });

  it('canAccessHome=false 时 capability 应清空首页模块且接口权限被回收', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.manager, {
      canAccessHome: false,
    });

    expect(accessControlService.getEffectivePermissions(membership)).toEqual(
      [],
    );
    expect(
      subjectCapabilityService.buildSnapshot(membership, 3).allowedHomeModules,
    ).toEqual([]);
  });

  it('canUseHandover=false 时 capability 与接口权限都应移除交班能力', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.manager, {
      canUseHandover: false,
    });
    const permissions =
      accessControlService.getEffectivePermissions(membership);
    const capability = subjectCapabilityService.buildSnapshot(membership, 3);

    expect(permissions).not.toContain('handover:view');
    expect(permissions).not.toContain('handover:create');
    expect(permissions).not.toContain('handover:update');
    expect(capability.allowedHomeModules).not.toContain('handover-management');
    expect(capability.canUseHandoverManagement).toBe(false);
  });

  it('cashier canUseHandover=false 时仍保留 goods:view', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.cashier, {
      canUseHandover: false,
    });
    const permissions =
      accessControlService.getEffectivePermissions(membership);

    expect(permissions).toContain('goods:view');
    expect(permissions).not.toContain('handover:view');
    expect(permissions).not.toContain('handover:create');
    expect(permissions).not.toContain('handover:update');
  });
});

describe('营销写权限放开后的硬例外（metadata）', () => {
  it('两个充值 controller 类级挂 SubAccountBlockGuard 但类级不封锁子账号', () => {
    for (const controller of [
      MarketingNewCustomerQuotaController,
      SmsController,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
        JwtAuthGuard,
        PermissionsGuard,
        SubAccountBlockGuard,
      ]);
      // 类级封锁会误伤概览 / 档位 / 流水 / 询价 / 群发等店长必用接口
      expect(Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, controller)).toBe(
        undefined,
      );
    }
  });

  it('仅新用户额度充值下单方法级封锁子账号，其余方法保持放行', () => {
    const quotaProto = MarketingNewCustomerQuotaController.prototype;

    expect(
      Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, quotaProto.recharge),
    ).toBe(true);
    for (const method of [
      quotaProto.getOverview,
      quotaProto.getTiers,
      quotaProto.getLogs,
      quotaProto.getRechargeStatus,
    ]) {
      expect(
        Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, method),
      ).toBeUndefined();
    }
  });

  it('仅短信余额充值下单方法级封锁子账号，群发与查询保持放行', () => {
    const smsProto = SmsController.prototype;

    expect(
      Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, smsProto.createRechargeOrder),
    ).toBe(true);
    for (const method of [
      smsProto.getAccount,
      smsProto.createQuote,
      smsProto.createBroadcast,
      smsProto.getRechargeOrderStatus,
      smsProto.getWallet,
      smsProto.getRechargeTiers,
      smsProto.listWalletLogs,
      smsProto.listBroadcasts,
      smsProto.getBroadcastDetail,
      smsProto.listBroadcastRecipients,
    ]) {
      expect(
        Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, method),
      ).toBeUndefined();
    }
  });

  it('门店坐标专用接口只要求营销权限，且不放开门店设置接口', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MarketingStoreLocationController.prototype.updateStoreLocation,
      ),
    ).toEqual(['marketing:manage']);
    // 读走 marketing:view：坐标页首屏必须能拿到门店数据（GET /stores/current 对子账号 403）
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MarketingStoreLocationController.prototype.getStoreLocation,
      ),
    ).toEqual(['marketing:view']);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MarketingStoreLocationController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    // 类级不得挂子账号封锁：坐标读写给店长用
    expect(
      Reflect.getMetadata(
        BLOCK_SUB_ACCOUNT_KEY,
        MarketingStoreLocationController,
      ),
    ).toBeUndefined();
    // 门店设置整块仍是主账号专属（含微信收款配置写接口）
    expect(Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, StoresController)).toBe(
      true,
    );
  });
});

describe('Permission metadata regression', () => {
  it('MarketingOverviewController 应启用登录态与权限 guard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MarketingOverviewController),
    ).toEqual([JwtAuthGuard, PermissionsGuard, SubAccountBlockGuard]);
  });

  it('优惠活动 controller 应类级封锁子账号，营销概览 controller 不得类级封锁', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MarketingPromotionsController),
    ).toEqual([JwtAuthGuard, PermissionsGuard, SubAccountBlockGuard]);
    expect(
      Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, MarketingPromotionsController),
    ).toBe(true);
    // 概览接口是店长进入营销中心的必要接口，类级封锁会误伤
    expect(
      Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, MarketingOverviewController),
    ).toBeUndefined();
  });

  it('会员等级读写方法逐方法封锁子账号，overview 保持放行', () => {
    const prototype = MarketingOverviewController.prototype;

    expect(
      Reflect.getMetadata(
        BLOCK_SUB_ACCOUNT_KEY,
        prototype.getMemberLevelSettings,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, prototype.updateMemberLevel),
    ).toBe(true);
    expect(
      Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, prototype.updatePointsRatio),
    ).toBe(true);
    expect(
      Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, prototype.getOverview),
    ).toBeUndefined();
  });

  it.each([
    MarketingOverviewController,
    MarketingCustomersController,
    MarketingPromotionsController,
    MarketingProductsController,
    MarketingProductCategoriesController,
    MarketingTransactionsController,
  ])('%p 应允许老 owner 走 marketing 兼容鉴权', (controller) => {
    expect(Reflect.getMetadata(ALLOW_LEGACY_OWNER_ACCESS_KEY, controller)).toBe(
      true,
    );
  });

  it('营业收录与销售记录接口权限应拆分', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SalesRecordController)).toBe(
      'sales-record',
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, SalesOrdersCompatController),
    ).toEqual(['sales/orders', 'sales-orders']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        SalesRecordController.prototype.listProducts,
      ),
    ).toEqual(['operation-entry:view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        SalesRecordController.prototype.list,
      ),
    ).toEqual(['sales:view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        SalesRecordController.prototype.create,
      ),
    ).toEqual(['sales:create']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        SalesOrdersCompatController.prototype.listProducts,
      ),
    ).toEqual(['operation-entry:view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        SalesOrdersCompatController.prototype.list,
      ),
    ).toEqual(['sales:view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        SalesOrdersCompatController.prototype.getReport,
      ),
    ).toEqual(['report:view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        SalesOrdersCompatController.prototype.create,
      ),
    ).toEqual(['operation-entry:create']);
  });

  it('空间会话写接口应要求 operation-entry:create', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        SpaceSessionsController.prototype.openSession,
      ),
    ).toEqual(['operation-entry:create']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        SpaceSessionsController.prototype.checkout,
      ),
    ).toEqual(['operation-entry:create']);
  });

  it('经营分析与财务报表应要求 report:view', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        BusinessAnalysisController.prototype.getAnalysis,
      ),
    ).toEqual(['report:view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        FinanceController.prototype.getReport,
      ),
    ).toEqual(['report:view']);
  });

  it('财务总览应要求 finance:view', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        FinanceController.prototype.getOverview,
      ),
    ).toEqual(['finance:view']);
  });

  it('库存调整写接口应允许库存管理或营业录入权限', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        InventoryController.prototype.adjust,
      ),
    ).toEqual(['inventory:update', 'operation-entry:create']);
  });

  it('工资草稿相关写接口应仅允许财务操作', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        EmployeesPayrollsController.prototype.savePayroll,
      ),
    ).toEqual(['finance:manage']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        EmployeesPayrollsController.prototype.updatePayroll,
      ),
    ).toEqual(['finance:manage']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        EmployeesPayrollsController.prototype.confirmPayroll,
      ),
    ).toEqual(['finance:manage']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        EmployeesPayrollsController.prototype.removePayroll,
      ),
    ).toEqual(['finance:manage']);
  });

  it('首页概览应允许经营分析与营业收录权限任一通过', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        DashboardHomeController.prototype.getOverview,
      ),
    ).toEqual(['report:view', 'operation-entry:view']);
  });

  it('会员卡接口应按只读 / 管理拆分权限码', () => {
    // 只读：持卡列表 / 详情 / 流水 / 售卡订单——空间管理面板内收银员与店长均需访问
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MemberCardsController.prototype.listCards,
      ),
    ).toEqual(['member-card:view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MemberCardsController.prototype.getCardDetail,
      ),
    ).toEqual(['member-card:view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MemberCardsController.prototype.listTransactions,
      ),
    ).toEqual(['member-card:view']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MemberCardOrdersController.prototype.listOrders,
      ),
    ).toEqual(['member-card:view']);
    // 管理：卡模板维护与手动调次属权益配置，仅主账号与店长
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MemberCardPlansController.prototype.listPlans,
      ),
    ).toEqual(['member-card:manage']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MemberCardPlansController.prototype.createPlan,
      ),
    ).toEqual(['member-card:manage']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MemberCardPlansController.prototype.updatePlan,
      ),
    ).toEqual(['member-card:manage']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MemberCardPlansController.prototype.togglePlan,
      ),
    ).toEqual(['member-card:manage']);
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        MemberCardsController.prototype.adjustTimes,
      ),
    ).toEqual(['member-card:manage']);
  });

  it('门店设置应同时启用权限 guard 与子账号封禁 guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StoresController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
      SubAccountBlockGuard,
    ]);
  });

  it.each([
    PlatformMembershipController,
    PromotionDetailCompatController,
    PartnerReviewController,
  ])('%p 应继续封禁子账号访问平台会员中心', (controller) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
      SubAccountBlockGuard,
    ]);
  });
});
