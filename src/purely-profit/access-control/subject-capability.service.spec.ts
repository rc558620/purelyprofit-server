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

  const buildSubAccountMembership = (role: StoreSubAccountRole) => ({
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

  it('manager 首页模块应按前端设计仅保留营业收录/会员/空间/交班', () => {
    const snapshot = service.buildSnapshot(
      buildSubAccountMembership(StoreSubAccountRole.manager),
      3,
    );

    expect(snapshot.allowedHomeModules).toEqual([
      'additional',
      'handover-management',
      'member-center',
      'space-management',
    ]);
    expect(snapshot.hiddenHomeModules).toContain('finance-center');
    expect(snapshot.hiddenHomeModules).toContain('marketing-center');
    expect(snapshot.hiddenHomeModules).toContain('store-settings');
    expect(snapshot.canViewFinance).toBe(false);
    expect(snapshot.canViewMarketing).toBe(false);
    expect(snapshot.canUseHandoverManagement).toBe(true);
    expect(snapshot.canUseSpaceManagement).toBe(true);
    expect(snapshot.canAccessStoreSettings).toBe(false);
  });

  it('finance 首页模块应仅保留经营分析和财务中心', () => {
    const snapshot = service.buildSnapshot(
      buildSubAccountMembership(StoreSubAccountRole.finance),
      3,
    );

    expect(snapshot.allowedHomeModules).toEqual([
      'business-analysis',
      'finance-center',
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
});
