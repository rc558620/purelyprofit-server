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
    canUseHandover: role !== StoreSubAccountRole.finance,
    ...overrides,
  });

  it('cashier 子账号应仅拥有营业收录/空间/商品查看/交班权限', () => {
    const permissions = service.getEffectivePermissions(
      buildSubAccountMembership(StoreSubAccountRole.cashier),
    );

    expect(permissions).toEqual([
      'space:view',
      'space:create',
      'space:update',
      'operation-entry:view',
      'operation-entry:create',
      'goods:view',
      'handover:view',
      'handover:create',
      'handover:update',
    ]);
    expect(permissions).toContain('goods:view');
    expect(permissions).not.toContain('sales:view');
  });

  it('manager 子账号应拥有门店运营权限，但不包含财务和门店设置权限', () => {
    const permissions = service.getEffectivePermissions(
      buildSubAccountMembership(StoreSubAccountRole.manager),
    );

    expect(permissions).toEqual([
      'staff:view',
      'staff:create',
      'staff:update',
      'marketing:view',
      'marketing:manage',
      'report:view',
      'goods:view',
      'goods:create',
      'goods:update',
      'supplier:view',
      'supplier:create',
      'supplier:update',
      'purchase:view',
      'purchase:create',
      'cost:view',
      'operation-entry:view',
      'operation-entry:create',
      'operation-entry:delete',
      'sales:view',
      'sales:create',
      'sales:delete',
      'inventory:view',
      'inventory:update',
      'space:view',
      'space:create',
      'space:update',
      'space:delete',
      'handover:view',
      'handover:create',
      'handover:update',
    ]);
    expect(permissions).not.toContain('members:view');
    expect(permissions).not.toContain('partner:view');
    expect(permissions).not.toContain('finance:view');
    expect(permissions).not.toContain('finance:export');
    expect(permissions).not.toContain('store:view');
    expect(permissions).not.toContain('store:update');
  });

  it('finance 子账号应拥有财务与进货管理操作权限', () => {
    const permissions = service.getEffectivePermissions(
      buildSubAccountMembership(StoreSubAccountRole.finance),
    );

    expect(permissions).toEqual([
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
    ]);
    expect(permissions).toContain('inventory:update');
    expect(permissions).toContain('supplier:view');
    expect(permissions).toContain('supplier:create');
    expect(permissions).toContain('supplier:update');
    expect(permissions).toContain('purchase:view');
    expect(permissions).toContain('purchase:create');
    expect(permissions).not.toContain('space:view');
    expect(permissions).not.toContain('handover:view');
    expect(permissions).not.toContain('operation-entry:view');
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
      'operation-entry:view',
      'operation-entry:create',
      'goods:view',
    ]);
    expect(permissions).toContain('goods:view');
    expect(permissions).not.toContain('handover:view');
    expect(permissions).not.toContain('handover:create');
    expect(permissions).not.toContain('handover:update');
  });

  it('resolveCurrentStoreIdByPermission 应优先使用当前登录 membership 的权限', () => {
    const storeId = service.resolveCurrentStoreIdByPermission(
      {
        currentMembership: buildSubAccountMembership(
          StoreSubAccountRole.finance,
        ),
      },
      'finance:view',
    );

    expect(storeId).toBe(18);
    expect(
      service.resolveCurrentStoreIdByPermission(
        {
          currentMembership: buildSubAccountMembership(
            StoreSubAccountRole.finance,
          ),
        },
        'marketing:view',
      ),
    ).toBeNull();
  });

  it('canAccessHome=false 时 resolveCurrentStoreIdByPermission 应回收权限并返回 null', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.finance, {
      canAccessHome: false,
    });

    expect(
      service.resolveCurrentStoreIdByPermission(
        { currentMembership: membership },
        'finance:view',
      ),
    ).toBeNull();
  });

  it('canAccessHome=false 且 permissions 非空时 resolveCurrentStoreIdByPermission 仍应回收权限', () => {
    const membership = buildSubAccountMembership(StoreSubAccountRole.cashier, {
      canAccessHome: false,
      permissions: ['space:view', 'goods:view'],
    });

    expect(
      service.resolveCurrentStoreIdByPermission(
        { currentMembership: membership },
        'space:view',
      ),
    ).toBeNull();
    expect(
      service.resolveCurrentStoreIdByPermission(
        { currentMembership: membership },
        'goods:view',
      ),
    ).toBeNull();
  });

  it('buildMembershipContext 子账号 canAccessHome 为 null 时应默认 false', () => {
    const result = service.buildMembershipContext(
      {
        id: 1,
        storeId: 10,
        role: StaffRole.staff,
        permissions: [],
        isActive: true,
        linkedEmployeeId: null,
      },
      {
        id: 5,
        employeeId: null,
        role: StoreSubAccountRole.cashier,
        status: StoreSubAccountStatus.active,
        isAssigned: true,
        canAccessHome: null as unknown as boolean,
        canUseHandover: true,
      },
    );

    expect(result.canAccessHome).toBe(false);
    expect(result.permissions).toEqual([]);
  });

  it('buildMembershipContext 主账号 canAccessHome 应为 true', () => {
    const result = service.buildMembershipContext({
      id: 1,
      storeId: 10,
      role: StaffRole.owner,
      permissions: ['*'],
      isActive: true,
    });

    expect(result.canAccessHome).toBe(true);
  });

  it('resolveCurrentStaffIdForStore 应返回当前 membership 的 staffId', () => {
    expect(
      service.resolveCurrentStaffIdForStore(
        {
          currentMembership: buildSubAccountMembership(
            StoreSubAccountRole.manager,
          ),
        },
        18,
      ),
    ).toBe(8);
    expect(
      service.resolveCurrentStaffIdForStore(
        {
          currentMembership: buildSubAccountMembership(
            StoreSubAccountRole.manager,
          ),
        },
        19,
      ),
    ).toBeNull();
  });
});
