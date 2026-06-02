import {
  StaffRole,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import { AccessControlService } from './access-control.service';
import { SubjectCapabilityService } from './subject-capability.service';

describe('SubjectCapabilityService', () => {
  let service: SubjectCapabilityService;

  beforeEach(() => {
    service = new SubjectCapabilityService(new AccessControlService());
  });

  const buildSubAccountMembership = (
    role: StoreSubAccountRole,
    overrides: Partial<{
      subAccountStatus: StoreSubAccountStatus;
      subAccountAssigned: boolean;
      canAccessHome: boolean;
      canUseHandover: boolean;
    }> = {},
  ) => ({
    staffId: 8,
    storeId: 18,
    role: StaffRole.STAFF,
    permissions: [],
    isActive: true,
    subjectType: 'sub_account' as const,
    linkedEmployeeId: 12,
    subAccountId: 6,
    subAccountRole: role,
    subAccountStatus: StoreSubAccountStatus.active,
    subAccountAssigned: true,
    canAccessHome: true,
    canUseHandover: role !== StoreSubAccountRole.finance,
    ...overrides,
  });

  it('cashier 首页模块应仅保留营业收录/空间/交班', () => {
    const snapshot = service.buildSnapshot(
      buildSubAccountMembership(StoreSubAccountRole.cashier),
      3,
    );

    expect(snapshot.allowedHomeModules).toEqual([
      'additional',
      'space-management',
      'handover-management',
    ]);
    expect(snapshot.canViewFinance).toBe(false);
    expect(snapshot.canUseHandoverManagement).toBe(true);
    expect(snapshot.canUseSpaceManagement).toBe(true);
  });

  it('manager 首页模块应开放门店运营相关模块，并排除财务与门店设置', () => {
    const snapshot = service.buildSnapshot(
      buildSubAccountMembership(StoreSubAccountRole.manager),
      3,
    );

    expect(snapshot.allowedHomeModules).toEqual([
      'additional',
      'business-analysis',
      'goods-management',
      'handover-management',
      'marketing-center',
      'space-management',
      'staff-management',
    ]);
    expect(snapshot.hiddenHomeModules).toContain('finance-center');
    expect(snapshot.hiddenHomeModules).toContain('member-center');
    expect(snapshot.hiddenHomeModules).toContain('store-settings');
    expect(snapshot.canViewFinance).toBe(false);
    expect(snapshot.canViewMarketing).toBe(true);
    expect(snapshot.canUseHandoverManagement).toBe(true);
    expect(snapshot.canUseSpaceManagement).toBe(true);
    expect(snapshot.canAccessStoreSettings).toBe(false);
  });

  it('finance 首页模块应保留经营分析、财务、商品与员工模块', () => {
    const snapshot = service.buildSnapshot(
      buildSubAccountMembership(StoreSubAccountRole.finance),
      3,
    );

    expect(snapshot.allowedHomeModules).toEqual([
      'business-analysis',
      'finance-center',
      'goods-management',
      'staff-management',
    ]);
    expect(snapshot.hiddenHomeModules).toContain('member-center');
    expect(snapshot.hiddenHomeModules).toContain('marketing-center');
    expect(snapshot.hiddenHomeModules).toContain('handover-management');
    expect(snapshot.hiddenHomeModules).toContain('space-management');
    expect(snapshot.hiddenHomeModules).toContain('store-settings');
    expect(snapshot.canViewFinance).toBe(true);
    expect(snapshot.canViewMarketing).toBe(false);
    expect(snapshot.canUseHandoverManagement).toBe(false);
    expect(snapshot.canUseSpaceManagement).toBe(false);
    expect(snapshot.canAccessStoreSettings).toBe(false);
  });

  it('禁用首页访问时不应返回任何首页模块', () => {
    const snapshot = service.buildSnapshot(
      buildSubAccountMembership(StoreSubAccountRole.manager, {
        canAccessHome: false,
      }),
      3,
    );

    expect(snapshot.allowedHomeModules).toEqual([]);
    expect(snapshot.hiddenHomeModules).toEqual([
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
    ]);
  });

  it('禁用交班时应从首页 capability 中移除交班模块', () => {
    const snapshot = service.buildSnapshot(
      buildSubAccountMembership(StoreSubAccountRole.manager, {
        canUseHandover: false,
      }),
      3,
    );

    expect(snapshot.allowedHomeModules).toEqual([
      'additional',
      'business-analysis',
      'goods-management',
      'marketing-center',
      'space-management',
      'staff-management',
    ]);
    expect(snapshot.hiddenHomeModules).toContain('handover-management');
    expect(snapshot.canUseHandoverManagement).toBe(false);
  });
});
