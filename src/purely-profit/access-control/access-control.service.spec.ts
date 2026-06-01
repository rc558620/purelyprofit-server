import {
  StaffRole,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import {
  AccessControlService,
  type AuthenticatedMembership,
} from './access-control.service';

describe('AccessControlService', () => {
  let service: AccessControlService;

  beforeEach(() => {
    service = new AccessControlService();
  });

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

  it('cashier 子账号应仅拥有收银/空间/交班权限', () => {
    const permissions = service.getEffectivePermissions(
      buildSubAccountMembership(StoreSubAccountRole.cashier),
    );

    expect(permissions).toEqual([
      'space:view',
      'space:create',
      'space:update',
      'sales:view',
      'sales:create',
      'handover:view',
      'handover:create',
      'handover:update',
    ]);
  });

  it('manager 子账号应按前端设计排除财务/营销/门店设置权限', () => {
    const permissions = service.getEffectivePermissions(
      buildSubAccountMembership(StoreSubAccountRole.manager),
    );

    expect(permissions).toEqual([
      'members:view',
      'members:create',
      'members:update',
      'partner:view',
      'sales:view',
      'sales:create',
      'space:view',
      'space:create',
      'space:update',
      'handover:view',
      'handover:create',
      'handover:update',
    ]);
    expect(permissions).not.toContain('finance:view');
    expect(permissions).not.toContain('marketing:view');
    expect(permissions).not.toContain('store:view');
    expect(permissions).not.toContain('store:update');
  });

  it('finance 子账号应仅拥有财务和经营分析相关权限', () => {
    const permissions = service.getEffectivePermissions(
      buildSubAccountMembership(StoreSubAccountRole.finance),
    );

    expect(permissions).toEqual([
      'finance:view',
      'finance:export',
      'report:view',
    ]);
    expect(permissions).not.toContain('goods:view');
    expect(permissions).not.toContain('space:view');
    expect(permissions).not.toContain('staff:view');
    expect(permissions).not.toContain('handover:view');
  });

  it('禁用交班时应从 cashier 权限中移除 handover:*', () => {
    const permissions = service.getEffectivePermissions(
      buildSubAccountMembership(StoreSubAccountRole.cashier, {
        canUseHandover: false,
      }),
    );

    expect(permissions).toEqual([
      'space:view',
      'space:create',
      'space:update',
      'sales:view',
      'sales:create',
    ]);
  });
});
