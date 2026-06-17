import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessControlService } from '../access-control/access-control.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { MarketingAccessService } from './marketing-access.service';

describe('MarketingAccessService', () => {
  let service: MarketingAccessService;

  const accessControlService = {
    resolveCurrentStoreIdByPermission: jest.fn(),
  };
  const prismaService = {
    store: {
      findFirst: jest.fn(),
    },
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(
      null,
    );
    prismaService.store.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingAccessService,
        { provide: AccessControlService, useValue: accessControlService },
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<MarketingAccessService>(MarketingAccessService);
  });

  it('getManageableStoreId 在当前 membership 有权限时返回 storeId', async () => {
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(18);

    await expect(
      service.getManageableStoreId(user, 'marketing:view'),
    ).resolves.toBe(18);
  });

  it('getManageableStoreId 在当前 membership 无权限时返回 null', async () => {
    await expect(
      service.getManageableStoreId(user, 'marketing:view'),
    ).resolves.toBeNull();
  });

  it('getManageableStoreId 在老 owner 无 membership 时回退到 ownerId 门店', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });

    await expect(
      service.getManageableStoreId(user, 'marketing:view'),
    ).resolves.toBe(18);
  });

  it('getManageableStoreId 在 membership 无营销权限但同属 owner 门店时回退成功', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });

    await expect(
      service.getManageableStoreId(
        {
          ...user,
          currentMembership: {
            staffId: 9,
            storeId: 18,
            role: 'STAFF',
            permissions: ['goods:view'],
            isActive: true,
            subjectType: 'staff',
            linkedEmployeeId: null,
            subAccountId: null,
            subAccountRole: null,
            subAccountStatus: null,
            subAccountAssigned: false,
            canAccessHome: true,
            canUseHandover: false,
          },
        },
        'marketing:view',
      ),
    ).resolves.toBe(18);
  });

  it('resolveViewStoreId 在无权限且未指定 storeId 时返回 null', async () => {
    await expect(
      service.resolveViewStoreId(user, undefined, '无权查看该门店的营销数据'),
    ).resolves.toBeNull();
  });

  it('resolveViewStoreId 在无权限但指定 storeId 时抛出异常', async () => {
    await expect(
      service.resolveViewStoreId(user, 18, '无权查看该门店的营销数据'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ensureCanAccess 在当前 membership 门店不匹配时抛出异常', async () => {
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);

    await expect(
      service.ensureCanAccess(user, 18, 'marketing:manage'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
