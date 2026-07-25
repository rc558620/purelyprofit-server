import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StoreBusinessCapabilityService } from './store-business-capability.service';
import { BusinessModeGuard } from './business-mode.guard';
import { BUSINESS_MODE_KEY } from './business-mode.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

describe('BusinessModeGuard', () => {
  let guard: BusinessModeGuard;
  let reflector: Reflector;
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
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
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

  const buildExecutionContext = (user?: AuthenticatedUser) =>
    ({
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
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

  describe('未声明 @RequireBusinessMode() 的接口', () => {
    it('直接放行', async () => {
      const context = buildExecutionContext(buildUser());

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(
        storeBusinessCapabilityService.getCapabilities,
      ).not.toHaveBeenCalled();
    });
  });

  describe("@RequireBusinessMode('catering')", () => {
    const setCateringRequirement = () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: string) => {
          if (key === BUSINESS_MODE_KEY) return 'catering';
          return undefined;
        });
    };

    it('餐饮门店通过', async () => {
      setCateringRequirement();
      storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
        isCateringStore: true,
        isGeneralStore: false,
      });

      const result = await guard.canActivate(
        buildExecutionContext(buildUser()),
      );

      expect(result).toBe(true);
    });

    it('非餐饮门店抛 ForbiddenException', async () => {
      setCateringRequirement();
      storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
        isCateringStore: false,
        isGeneralStore: true,
      });

      await expect(
        guard.canActivate(buildExecutionContext(buildUser())),
      ).rejects.toThrow(ForbiddenException);
    });

    it('门店未知/数据库失败抛 ForbiddenException', async () => {
      setCateringRequirement();
      storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
        isCateringStore: false,
        isGeneralStore: false,
      });

      await expect(
        guard.canActivate(buildExecutionContext(buildUser())),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("@RequireBusinessMode('general')", () => {
    const setGeneralRequirement = () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: string) => {
          if (key === BUSINESS_MODE_KEY) return 'general';
          return undefined;
        });
    };

    it('非餐饮门店通过', async () => {
      setGeneralRequirement();
      storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
        isCateringStore: false,
        isGeneralStore: true,
      });

      const result = await guard.canActivate(
        buildExecutionContext(buildUser()),
      );

      expect(result).toBe(true);
    });

    it('餐饮门店抛 ForbiddenException', async () => {
      setGeneralRequirement();
      storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
        isCateringStore: true,
        isGeneralStore: false,
      });

      await expect(
        guard.canActivate(buildExecutionContext(buildUser())),
      ).rejects.toThrow(ForbiddenException);
    });

    it('门店未知/数据库失败抛 ForbiddenException', async () => {
      setGeneralRequirement();
      storeBusinessCapabilityService.getCapabilities.mockResolvedValue({
        isCateringStore: false,
        isGeneralStore: false,
      });

      await expect(
        guard.canActivate(buildExecutionContext(buildUser())),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('未登录用户', () => {
    it('抛 ForbiddenException', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: string) => {
          if (key === BUSINESS_MODE_KEY) return 'catering';
          return undefined;
        });

      await expect(
        guard.canActivate(buildExecutionContext(undefined)),
      ).rejects.toThrow('请先登录后再操作');
    });
  });
});
