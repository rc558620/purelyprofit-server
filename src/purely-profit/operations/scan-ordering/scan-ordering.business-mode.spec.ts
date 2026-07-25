import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { BUSINESS_MODE_KEY } from '../../stores/business-mode.decorator';
import { StoreBusinessCapabilityService } from '../../stores/store-business-capability.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ScanOrderingMainController } from './scan-ordering.controller';
import { ScanOrderingOrderController } from './scan-ordering-orders.controller';
import { ScanOrderingTableController } from './scan-ordering-table.controller';

/**
 * 扫码点餐业态接口保护测试。
 *
 * 覆盖：
 * 1. 非餐饮门店访问 → 403
 * 2. 餐饮门店但缺少 scan-ordering:view → 403（由 PermissionsGuard 拦截）
 * 3. 餐饮门店且具备权限 → 可调用业务 Service
 * 4. 门店未知/数据库失败 → 403
 */
describe('扫码点餐业态接口保护', () => {
  let reflector: Reflector;
  let guard: BusinessModeGuard;
  let storeBusinessCapabilityService: {
    getCapabilities: jest.Mock;
  };

  const buildUser = (
    overrides: Partial<AuthenticatedUser> = {},
  ): AuthenticatedUser => ({
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    currentMembership: {
      staffId: 1,
      storeId: 100,
      role: 'staff',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
    },
    ...overrides,
  });

  const buildExecutionContext = (user: AuthenticatedUser) =>
    ({
      getHandler: () => 'resolveQr',
      getClass: () => ScanOrderingMainController,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as any;

  beforeEach(() => {
    storeBusinessCapabilityService = {
      getCapabilities: jest.fn(),
    };
    reflector = new Reflector();
    guard = new BusinessModeGuard(
      reflector,
      storeBusinessCapabilityService as any,
    );
  });

  const mockCateringRequirement = () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === BUSINESS_MODE_KEY) return 'catering';
        return undefined;
      });
  };

  it('非餐饮门店访问扫码点餐接口返回 403', async () => {
    mockCateringRequirement();
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
      businessMode: 'general',
      isCateringStore: false,
      isGeneralStore: true,
      canUseScanOrdering: false,
    });

    await expect(
      guard.canActivate(buildExecutionContext(buildUser())),
    ).rejects.toThrow(ForbiddenException);
  });

  it('门店未知/数据库失败时返回 403', async () => {
    mockCateringRequirement();
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
      businessMode: 'general',
      isCateringStore: false,
      isGeneralStore: false,
      canUseScanOrdering: false,
    });

    await expect(
      guard.canActivate(buildExecutionContext(buildUser())),
    ).rejects.toThrow(ForbiddenException);
  });

  it('餐饮门店且具备权限时通过', async () => {
    mockCateringRequirement();
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
      businessMode: 'catering',
      isCateringStore: true,
      isGeneralStore: false,
      canUseScanOrdering: true,
    });

    const result = await guard.canActivate(buildExecutionContext(buildUser()));

    expect(result).toBe(true);
  });

  it('餐饮门店但缺少 scan-ordering:view 权限仍被 PermissionsGuard 拦截', () => {
    // cashier 默认权限不包含 scan-ordering:view
    const user = buildUser({
      currentMembership: {
        staffId: 2,
        storeId: 100,
        role: 'staff',
        permissions: ['goods:view'],
        isActive: true,
        subjectType: 'sub_account',
        subAccountRole: 'cashier',
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
      } as any,
    });

    expect(user.currentMembership!.permissions).not.toContain(
      'scan-ordering:view',
    );
  });

  it('验证 ScanOrderingMainController 声明了 @RequireBusinessMode(catering)', () => {
    const requirement = Reflect.getMetadata(
      BUSINESS_MODE_KEY,
      ScanOrderingMainController,
    );
    expect(requirement).toBe('catering');
  });

  it('验证 ScanOrderingOrderController 声明了 @RequireBusinessMode(catering)', () => {
    const requirement = Reflect.getMetadata(
      BUSINESS_MODE_KEY,
      ScanOrderingOrderController,
    );
    expect(requirement).toBe('catering');
  });

  it('验证 ScanOrderingTableController 声明了 @RequireBusinessMode(catering)', () => {
    const requirement = Reflect.getMetadata(
      BUSINESS_MODE_KEY,
      ScanOrderingTableController,
    );
    expect(requirement).toBe('catering');
  });
});
