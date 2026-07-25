import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { BUSINESS_MODE_KEY } from '../../stores/business-mode.decorator';
import { StoreBusinessCapabilityService } from '../../stores/store-business-capability.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { SpacesController } from './spaces.controller';
import { SpaceSessionsController } from './space-sessions.controller';
import { SpaceReservationsController } from './space-reservations.controller';
import { SpaceTypesController } from './space-types.controller';
import { SpaceZonesController } from './space-zones.controller';

/**
 * 空间管理业态接口保护测试。
 *
 * 覆盖：
 * - 餐饮门店请求空间接口 → 403
 * - 非餐饮且具备原权限时通过
 * - 非餐饮但无原权限时仍返回 403
 * - 门店未知/数据库失败 → 403
 */
describe('空间管理业态接口保护', () => {
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
      getHandler: () => 'list',
      getClass: () => SpacesController,
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

  const mockGeneralRequirement = () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => {
        if (key === BUSINESS_MODE_KEY) return 'general';
        return undefined;
      });
  };

  it('餐饮门店请求空间接口返回 403', async () => {
    mockGeneralRequirement();
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
      businessMode: 'catering',
      isCateringStore: true,
      isGeneralStore: false,
      canUseSpaceManagement: false,
    });

    await expect(
      guard.canActivate(buildExecutionContext(buildUser())),
    ).rejects.toThrow(ForbiddenException);
  });

  it('非餐饮且具备原权限时通过', async () => {
    mockGeneralRequirement();
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
      businessMode: 'general',
      isCateringStore: false,
      isGeneralStore: true,
      canUseSpaceManagement: true,
    });

    const result = await guard.canActivate(buildExecutionContext(buildUser()));

    expect(result).toBe(true);
  });

  it('门店未知/数据库失败时返回 403', async () => {
    mockGeneralRequirement();
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
      businessMode: 'general',
      isCateringStore: false,
      isGeneralStore: false,
      canUseSpaceManagement: false,
    });

    await expect(
      guard.canActivate(buildExecutionContext(buildUser())),
    ).rejects.toThrow(ForbiddenException);
  });

  it('验证 SpacesController 声明了 @RequireBusinessMode(general)', () => {
    const requirement = Reflect.getMetadata(
      BUSINESS_MODE_KEY,
      SpacesController,
    );
    expect(requirement).toBe('general');
  });

  it('验证 SpaceSessionsController 声明了 @RequireBusinessMode(general)', () => {
    const requirement = Reflect.getMetadata(
      BUSINESS_MODE_KEY,
      SpaceSessionsController,
    );
    expect(requirement).toBe('general');
  });

  it('验证 SpaceReservationsController 声明了 @RequireBusinessMode(general)', () => {
    const requirement = Reflect.getMetadata(
      BUSINESS_MODE_KEY,
      SpaceReservationsController,
    );
    expect(requirement).toBe('general');
  });

  it('验证 SpaceTypesController 声明了 @RequireBusinessMode(general)', () => {
    const requirement = Reflect.getMetadata(
      BUSINESS_MODE_KEY,
      SpaceTypesController,
    );
    expect(requirement).toBe('general');
  });

  it('验证 SpaceZonesController 声明了 @RequireBusinessMode(general)', () => {
    const requirement = Reflect.getMetadata(
      BUSINESS_MODE_KEY,
      SpaceZonesController,
    );
    expect(requirement).toBe('general');
  });
});
