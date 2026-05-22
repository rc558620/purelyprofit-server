import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, StaffRole, StaffStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmployeesAccessService } from './employees-access.service';

describe('EmployeesAccessService', () => {
  let service: EmployeesAccessService;

  const prismaService = {
    staff: {
      findFirst: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
  };

  const accessControlService = {
    getEffectivePermissions: jest.fn(),
    hasPermission: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesAccessService,
        { provide: PrismaService, useValue: prismaService },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get<EmployeesAccessService>(EmployeesAccessService);
  });

  it('getManageableStoreId 在有权限时返回当前门店', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      storeId: 8,
      role: StaffRole.OWNER,
      permissions: [],
    });
    accessControlService.getEffectivePermissions.mockReturnValue(['*']);
    accessControlService.hasPermission.mockReturnValue(true);

    await expect(
      service.getManageableStoreId(user, 'staff:view'),
    ).resolves.toBe(8);
    expect(prismaService.staff.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ userId: user.id }, { email: user.email }, { phone: user.phone }],
        isActive: true,
        status: StaffStatus.ACTIVE,
      },
      select: {
        storeId: true,
        role: true,
        permissions: true,
      },
      orderBy: {
        id: 'asc',
      },
    });
  });

  it('getManageableStoreId 在无匹配 staff 时返回 null', async () => {
    prismaService.staff.findFirst.mockResolvedValue(null);

    await expect(
      service.getManageableStoreId(user, 'staff:view'),
    ).resolves.toBeNull();
    expect(accessControlService.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('resolveViewStoreId 在查询其他门店时抛出无权限异常', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      storeId: 8,
      role: StaffRole.MANAGER,
      permissions: ['staff:view'],
    });
    accessControlService.getEffectivePermissions.mockReturnValue([
      'staff:view',
    ]);
    accessControlService.hasPermission.mockReturnValue(true);

    await expect(
      service.resolveViewStoreId(user, 9, '无权查看该门店员工列表'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ensureCanManageEmployees 在目标门店不匹配时抛出异常', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      storeId: 8,
      role: StaffRole.MANAGER,
      permissions: ['staff:update'],
    });
    accessControlService.getEffectivePermissions.mockReturnValue([
      'staff:update',
    ]);
    accessControlService.hasPermission.mockReturnValue(true);

    await expect(
      service.ensureCanManageEmployees(user, 9, 'staff:update'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findEmployeeOrThrow 返回员工并校验门店权限', async () => {
    prismaService.employee.findUnique.mockResolvedValue({
      id: 11,
      storeId: 8,
      empNo: 'EMP011',
      status: EmployeeStatus.active,
    });
    prismaService.staff.findFirst.mockResolvedValue({
      storeId: 8,
      role: StaffRole.OWNER,
      permissions: [],
    });
    accessControlService.getEffectivePermissions.mockReturnValue(['*']);
    accessControlService.hasPermission.mockReturnValue(true);

    await expect(service.findEmployeeOrThrow(user, 11)).resolves.toEqual({
      id: 11,
      storeId: 8,
      empNo: 'EMP011',
      status: EmployeeStatus.active,
    });
  });

  it('findEmployeeOrThrow 在员工不存在时抛出异常', async () => {
    prismaService.employee.findUnique.mockResolvedValue(null);

    await expect(service.findEmployeeOrThrow(user, 999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolveSingleStoreId 在无门店权限时抛出异常', async () => {
    prismaService.staff.findFirst.mockResolvedValue(null);

    await expect(
      service.resolveSingleStoreId(user, undefined, 'staff:view'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
