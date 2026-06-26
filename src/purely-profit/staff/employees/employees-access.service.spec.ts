import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, StaffRole } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmployeesAccessService } from './employees-access.service';

describe('EmployeesAccessService', () => {
  let service: EmployeesAccessService;

  const prismaService = {
    employee: {
      findUnique: jest.fn(),
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
    lastActiveAt: null,
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(
      null,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesAccessService,
        { provide: PrismaService, useValue: prismaService },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get<EmployeesAccessService>(EmployeesAccessService);
  });

  it('getManageableStoreId 在当前 membership 有权限时直接返回当前门店', () => {
    const managerUser: AuthenticatedUser = {
      ...user,
      currentMembership: {
        staffId: 55,
        storeId: 48,
        role: StaffRole.staff,
        permissions: ['staff:view'],
        isActive: true,
        subjectType: 'sub_account',
        linkedEmployeeId: 6,
        subAccountId: 3,
        subAccountRole: 'manager',
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
      },
    };
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(48);

    expect(service.getManageableStoreId(managerUser, 'staff:view')).toBe(48);
  });

  it('getManageableStoreId 在当前 membership 无权限时返回 null', () => {
    expect(service.getManageableStoreId(user, 'staff:view')).toBeNull();
  });

  it('getManageableStoreId 支持工资场景的多权限兜底', () => {
    accessControlService.resolveCurrentStoreIdByPermission
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(8);

    expect(
      service.getManageableStoreId(user, ['staff:update', 'finance:view']),
    ).toBe(8);
    expect(
      accessControlService.resolveCurrentStoreIdByPermission,
    ).toHaveBeenNthCalledWith(1, user, 'staff:update');
    expect(
      accessControlService.resolveCurrentStoreIdByPermission,
    ).toHaveBeenNthCalledWith(2, user, 'finance:view');
  });

  it('resolveViewStoreId 在查询其他门店时抛出无权限异常', () => {
    expect(() =>
      service.resolveViewStoreId(user, 9, '无权查看该门店员工列表'),
    ).toThrow(ForbiddenException);
  });

  it('ensureCanManageEmployees 在目标门店不匹配时抛出异常', () => {
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);

    expect(() =>
      service.ensureCanManageEmployees(user, 9, 'staff:update'),
    ).toThrow(ForbiddenException);
  });

  it('findEmployeeOrThrow 返回员工并校验门店权限', async () => {
    prismaService.employee.findUnique.mockResolvedValue({
      id: 11,
      storeId: 8,
      empNo: 'EMP011',
      status: EmployeeStatus.active,
    });
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);

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

  it('resolveSingleStoreId 在无门店权限时抛出异常', () => {
    expect(() =>
      service.resolveSingleStoreId(user, undefined, 'staff:view'),
    ).toThrow(ForbiddenException);
  });
});
