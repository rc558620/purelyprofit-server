import { GUARDS_METADATA } from '@nestjs/common/constants';
import { StaffRole, StoreSubAccountRole, StoreSubAccountStatus } from '@prisma/client';
import { REQUIRE_PERMISSIONS_KEY } from './decorators/require-permissions.decorator';
import { AccessControlService, type AuthenticatedMembership } from './access-control.service';
import { SubjectCapabilityService } from './subject-capability.service';
import { PermissionsGuard } from './guards/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MarketingController } from '../marketing/marketing.controller';
import {
  PartnerReviewController,
  PlatformMembershipController,
  PromotionDetailCompatController,
} from '../member/platform-membership/platform-membership.controller';
import {
  SalesOrdersCompatController,
  SalesRecordController,
} from '../operations/sales-record/sales-record.controller';
import { SpaceSessionsController } from '../operations/spaces/space-sessions.controller';
import { FinanceController } from '../finance/finance.controller';
import { BusinessAnalysisController } from '../dashboard/business-analysis/business-analysis.controller';
import { DashboardHomeController } from '../dashboard/dashboard-home/dashboard-home.controller';
import { StoresController } from '../stores/stores.controller';
import { SubAccountBlockGuard } from './guards/sub-account-block.guard';

const accessControlService = new AccessControlService();
const subjectCapabilityService = new SubjectCapabilityService(accessControlService);

const buildSubAccountMembership = (
  role: StoreSubAccountRole,
  overrides: Partial<AuthenticatedMembership> = {},
): AuthenticatedMembership => ({
  staffId: 8,
  storeId: 18,
  role: StaffRole.STAFF,
  permissions: [],
  isActive: true,
  subjectType: 'sub_account',
  linkedEmployeeId: 12,
  subAccountId: 6,
  subAccountRole: role,
  subAccountStatus: StoreSubAccountStatus.active,
  subAccountAssigned: true,
  canAccessHome: true,
  canUseHandover: role !== StoreSubAccountRole.finance,
  ...overrides,
});

describe('Sub-account alignment regression', () => {
  it('cashier 的首页模块与关键接口权限保持一致', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.cashier);
    const permissions = accessControlService.getEffectivePermissions(membership);
    const capability = subjectCapabilityService.buildSnapshot(membership, 3);

    expect(capability.allowedHomeModules).toEqual([
      'additional',
      'space-management',
      'handover-management',
    ]);
    expect(permissions).toEqual([
      'space:view',
      'space:create',
      'space:update',
      'operation-entry:view',
      'operation-entry:create',
      'handover:view',
      'handover:create',
      'handover:update',
    ]);
    expect(permissions).not.toContain('sales:view');
    expect(permissions).not.toContain('marketing:view');
    expect(permissions).not.toContain('finance:view');
    expect(permissions).not.toContain('store:view');
  });

  it('manager 的首页模块与关键接口权限保持一致', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.manager);
    const permissions = accessControlService.getEffectivePermissions(membership);
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
    expect(permissions).toContain('report:view');
    expect(permissions).toContain('marketing:view');
    expect(permissions).toContain('goods:view');
    expect(permissions).toContain('inventory:view');
    expect(permissions).toContain('cost:view');
    expect(permissions).toContain('purchase:view');
    expect(permissions).toContain('sales:view');
    expect(permissions).toContain('staff:view');
    expect(permissions).not.toContain('members:view');
    expect(permissions).not.toContain('partner:view');
    expect(permissions).not.toContain('finance:view');
    expect(permissions).not.toContain('store:view');
  });

  it('finance 的首页模块与关键接口权限保持一致', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.finance);
    const permissions = accessControlService.getEffectivePermissions(membership);
    const capability = subjectCapabilityService.buildSnapshot(membership, 3);

    expect(capability.allowedHomeModules).toEqual([
      'business-analysis',
      'finance-center',
      'goods-management',
      'staff-management',
    ]);
    expect(permissions).toContain('report:view');
    expect(permissions).toContain('finance:view');
    expect(permissions).toContain('goods:view');
    expect(permissions).toContain('inventory:view');
    expect(permissions).toContain('cost:view');
    expect(permissions).toContain('purchase:view');
    expect(permissions).toContain('sales:view');
    expect(permissions).toContain('staff:view');
    expect(permissions).not.toContain('marketing:view');
    expect(permissions).not.toContain('space:view');
    expect(permissions).not.toContain('handover:view');
    expect(permissions).not.toContain('operation-entry:view');
    expect(permissions).not.toContain('store:view');
  });

  it('canAccessHome=false 时 capability 应清空首页模块且接口权限被回收', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.manager, {
      canAccessHome: false,
    });

    expect(accessControlService.getEffectivePermissions(membership)).toEqual([]);
    expect(subjectCapabilityService.buildSnapshot(membership, 3).allowedHomeModules).toEqual([]);
  });

  it('canUseHandover=false 时 capability 与接口权限都应移除交班能力', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.manager, {
      canUseHandover: false,
    });
    const permissions = accessControlService.getEffectivePermissions(membership);
    const capability = subjectCapabilityService.buildSnapshot(membership, 3);

    expect(permissions).not.toContain('handover:view');
    expect(permissions).not.toContain('handover:create');
    expect(permissions).not.toContain('handover:update');
    expect(capability.allowedHomeModules).not.toContain('handover-management');
    expect(capability.canUseHandoverManagement).toBe(false);
  });
});

describe('Permission metadata regression', () => {
  it('MarketingController 应启用登录态与权限 guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MarketingController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it('营业收录与销售记录接口权限应拆分', () => {
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
        SalesOrdersCompatController.prototype.list,
      ),
    ).toEqual(['sales:view']);
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

  it('首页概览应允许经营分析与营业收录权限任一通过', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        DashboardHomeController.prototype.getOverview,
      ),
    ).toEqual(['report:view', 'operation-entry:view']);
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
