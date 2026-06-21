import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../access-control/access-control.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from './commerce-access.service';

describe('CommerceAccessService', () => {
  let service: CommerceAccessService;

  const accessControlService = {
    resolveCurrentStoreIdByPermission: jest.fn(),
    resolveCurrentStaffIdForStore: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(
      null,
    );
    accessControlService.resolveCurrentStaffIdForStore.mockReturnValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommerceAccessService,
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get<CommerceAccessService>(CommerceAccessService);
  });

  it('getManageableStoreId 在当前 membership 有权限时返回 storeId', async () => {
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(18);

    await expect(
      service.getManageableStoreId(user, 'goods:view'),
    ).resolves.toBe(18);
  });

  it('getManageableStoreId 在当前 membership 无权限时返回 null', async () => {
    await expect(
      service.getManageableStoreId(user, 'goods:view'),
    ).resolves.toBeNull();
  });

  it('resolveSingleStoreId 在无权限时抛出异常', async () => {
    await expect(
      service.resolveSingleStoreId(
        user,
        undefined,
        'goods:view',
        '无权查看该门店商品',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ensureCanAccessStore 在当前 membership 门店不匹配时抛出异常', async () => {
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);

    await expect(
      service.ensureCanAccessStore(
        user,
        18,
        'goods:update',
        '无权操作该门店商品',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findOperatorStaffIdForStore 在当前 membership 命中时返回 staffId', async () => {
    accessControlService.resolveCurrentStaffIdForStore.mockReturnValue(55);

    await expect(service.findOperatorStaffIdForStore(user, 18)).resolves.toBe(
      55,
    );
  });

  it('findOperatorStaffIdForStore 在当前 membership 未命中时返回 null', async () => {
    await expect(
      service.findOperatorStaffIdForStore(user, 18),
    ).resolves.toBeNull();
  });
});
