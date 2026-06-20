import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { StaffAccessService } from './staff-access.service';

describe('StaffAccessService', () => {
  let service: StaffAccessService;

  const prismaService = {
    store: {
      findFirst: jest.fn(),
    },
    staff: {
      findFirst: jest.fn(),
    },
  };

  const accessControlService = {
    resolveCurrentStoreIdByPermission: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffAccessService,
        { provide: PrismaService, useValue: prismaService },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get<StaffAccessService>(StaffAccessService);
  });

  it('getManageableStoreId 在当前 membership 有权限时直接返回门店', async () => {
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(18);

    await expect(
      service.getManageableStoreId(user, 'staff:view'),
    ).resolves.toBe(18);
  });

  it('getManageableStoreId 在当前 membership 无权限时返回 null', async () => {
    await expect(
      service.getManageableStoreId(user, 'staff:view'),
    ).resolves.toBeNull();
  });

  it('ensureCanManageStaff 在门店不匹配时抛出异常', async () => {
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);

    await expect(
      service.ensureCanManageStaff(user, 18, 'staff:update'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findManageableStaffOrThrow 返回员工并校验权限', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      id: 11,
      storeId: 18,
      role: StaffRole.MANAGER,
      isSeatActive: true,
    });
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(18);

    await expect(
      service.findManageableStaffOrThrow(user, 11, 'staff:update'),
    ).resolves.toEqual({
      id: 11,
      storeId: 18,
      role: StaffRole.MANAGER,
      isSeatActive: true,
    });
  });

  it('findManageableStaffOrThrow 在员工不存在时抛出异常', async () => {
    prismaService.staff.findFirst.mockResolvedValue(null);

    await expect(
      service.findManageableStaffOrThrow(user, 11, 'staff:update'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findManageableStaffOrThrow 在目标为 owner 时抛出异常', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      id: 11,
      storeId: 18,
      role: StaffRole.OWNER,
      isSeatActive: true,
    });
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(18);

    await expect(
      service.findManageableStaffOrThrow(user, 11, 'staff:delete'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ensureAccountCanOnlyBindSingleStore 在已有其他门店绑定时抛出异常', async () => {
    prismaService.store.findFirst.mockResolvedValue(null);
    prismaService.staff.findFirst.mockResolvedValue({ id: 9, storeId: 3 });

    await expect(
      service.ensureAccountCanOnlyBindSingleStore(18, 'boss@example.com', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
