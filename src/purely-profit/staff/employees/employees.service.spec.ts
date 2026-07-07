import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmployeeGender,
  EmployeePayrollStatus,
  EmployeeStatus,
  Prisma,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CostsService } from '../../operations/costs/costs.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesDictionaryService } from './employees-dictionary.service';
import { EmployeesLeaveService } from './employees-leave.service';
import { EmployeesPayrollService } from './employees-payroll.service';
import { EmployeesProfileReadService } from './employees-profile-read.service';
import { EmployeesProfileWriteService } from './employees-profile-write.service';
import { EmployeesService } from './employees.service';
import { EmployeesShiftService } from './employees-shift.service';
import { EmployeesShiftDefinitionService } from './employees-shift-definition.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { StoreSubAccountLoginService } from '../../member/platform-membership/store-sub-account-login.service';

describe('EmployeesService', () => {
  let service: EmployeesService;

  const prismaService = {
    employee: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    employeeDepartment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employeePosition: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employeeLeave: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    employeeShift: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    employeePayroll: {
      count: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    storeSubAccount: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    staff: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  const employeesAccessService = {
    resolveViewStoreId: jest.fn(),
    getManageableStoreId: jest.fn(),
    ensureCanManageEmployees: jest.fn(),
    findManageableEmployeeOrThrow: jest.fn(),
    resolveSingleStoreId: jest.fn(),
    ensureCanManageEmployeeSubAccount: jest.fn(),
    buildEmployeeDetailCapabilities: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  const costsService = {
    syncPayrollCosts: jest.fn(),
  };

  const platformMembershipAccessService = {
    ensureEmployeeQuotaAvailable: jest.fn(),
  };

  const storeSubAccountService = {
    updateSlot: jest.fn(),
    findAvailableSlotIndex: jest.fn(),
    getStoreSubAccountSummary: jest.fn(),
    findAssignedSubAccountByEmployee: jest.fn(),
  };

  const employeesShiftDefinitionService = {
    listShiftDefinitions: jest.fn(),
    createShiftDefinition: jest.fn(),
    updateShiftDefinition: jest.fn(),
    removeShiftDefinition: jest.fn(),
    findShiftDefinitionForStoreOrThrow: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidateDashboardAndPulseSession: jest.fn().mockResolvedValue(undefined),
    invalidateProfitDashboardHome: jest.fn().mockResolvedValue(undefined),
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

    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, number> = {
        'app.defaultPageSize': 10,
        'app.maxPageSize': 50,
      };
      return configMap[key];
    });
    employeesAccessService.ensureCanManageEmployeeSubAccount.mockImplementation(
      () => undefined,
    );
    employeesAccessService.buildEmployeeDetailCapabilities.mockReturnValue({
      canViewSubAccountModule: true,
      canResign: true,
    });

    prismaService.$transaction.mockImplementation(
      (callback: (tx: typeof prismaService) => unknown) =>
        callback(prismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        EmployeesProfileReadService,
        EmployeesProfileWriteService,
        EmployeesDictionaryService,
        EmployeesLeaveService,
        EmployeesShiftService,
        EmployeesPayrollService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
        { provide: EmployeesAccessService, useValue: employeesAccessService },
        { provide: ConfigService, useValue: configService },
        { provide: CostsService, useValue: costsService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
        { provide: StoreSubAccountService, useValue: storeSubAccountService },
        {
          provide: StoreSubAccountLoginService,
          useValue: { ensureEmployeeHasLoginAccount: jest.fn() },
        },
        {
          provide: EmployeesShiftDefinitionService,
          useValue: employeesShiftDefinitionService,
        },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
  });

  it('list 会按权限门店和分页条件查询员工列表', async () => {
    const createdAt = new Date('2026-05-10T10:00:00.000Z');
    const updatedAt = new Date('2026-05-11T10:00:00.000Z');

    employeesAccessService.resolveViewStoreId.mockResolvedValue(2);
    prismaService.employee.findMany.mockResolvedValue([
      {
        id: 12,
        storeId: 2,
        linkedStaffId: null,
        departmentId: 3,
        positionId: 4,
        empNo: 'EMP012',
        name: '张三',
        phone: '13800138000',
        position: '店长',
        department: '前厅',
        joinDate: new Date('2026-05-01T00:00:00.000Z'),
        baseSalary: 580000,
        avatar: null,
        idCard: null,
        gender: EmployeeGender.male,
        emergencyContact: '李四',
        emergencyPhone: '13800138001',
        contractEndDate: null,
        note: '核心员工',
        status: EmployeeStatus.active,
        resignDate: null,
        resignReason: null,
        createdAt,
        updatedAt,
      },
    ]);
    prismaService.employee.count.mockResolvedValue(21);
    prismaService.storeSubAccount.findMany.mockResolvedValue([
      {
        id: 7,
        employeeId: 12,
        slotIndex: 2,
        role: 'cashier',
        status: 'active',
        canUseHandover: true,
        createdAt,
        updatedAt,
      },
    ]);
    prismaService.staff.findMany.mockResolvedValue([
      {
        id: 18,
        phone: '13800138000',
        email: 'account_store_mgr01@purelyprofit.local',
        loginAccount: 'store_mgr01',
        updatedAt,
        employeeProfile: { id: 12 },
        user: { password: 'hashed-password' },
      },
    ]);

    const result = await service.list(user, {
      storeId: 2,
      status: EmployeeStatus.active,
      department: '前厅',
      keyword: '张',
      page: 2,
      pageSize: 5,
    });

    expect(employeesAccessService.resolveViewStoreId).toHaveBeenCalledWith(
      user,
      2,
      '无权查看该门店员工列表',
    );
    expect(prismaService.employee.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 2,
        deletedAt: null,
        status: EmployeeStatus.active,
        department: { equals: '前厅', mode: 'insensitive' },
        OR: [
          { name: { contains: '张', mode: 'insensitive' } },
          { empNo: { contains: '张', mode: 'insensitive' } },
          { phone: { startsWith: '张' } },
          { position: { contains: '张', mode: 'insensitive' } },
          { department: { contains: '张', mode: 'insensitive' } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 5,
      take: 5,
    });
    expect(result).toEqual({
      items: [
        {
          id: '12',
          empNo: 'EMP012',
          name: '张三',
          phone: '13800138000',
          position: '店长',
          department: '前厅',
          joinDate: new Date('2026-05-01T00:00:00.000Z').getTime(),
          baseSalary: 5800,
          gender: EmployeeGender.male,
          emergencyContact: '李四',
          emergencyPhone: '13800138001',
          note: '核心员工',
          status: EmployeeStatus.active,
          createdAt: createdAt.getTime(),
          updatedAt: updatedAt.getTime(),
          subAccount: {
            id: '7',
            role: 'cashier',
            roleLabel: '收银员',
            status: 'active',
            slotIndex: 2,
            loginAccount: '13800138000 / store_mgr01',
            canHandover: true,
            hasPassword: true,
            createdAt: createdAt.getTime(),
            updatedAt: updatedAt.getTime(),
          },
        },
      ],
      meta: {
        page: 2,
        pageSize: 5,
        total: 21,
        totalPages: 5,
      },
    });
  });

  it('list 在未指定状态时会保持在职员工优先', async () => {
    employeesAccessService.resolveViewStoreId.mockResolvedValue(2);
    prismaService.employee.findMany.mockResolvedValue([]);
    prismaService.employee.count.mockResolvedValue(0);

    await service.list(user, {
      storeId: 2,
      page: 1,
      pageSize: 10,
    });

    expect(prismaService.employee.findMany).toHaveBeenCalledWith({
      where: { storeId: 2, deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 10,
    });
    expect(prismaService.storeSubAccount.findMany).not.toHaveBeenCalled();
    expect(prismaService.staff.findMany).not.toHaveBeenCalled();
  });

  it('getDetail 对财务子账号隐藏子账号模块且不可办理离职', async () => {
    const financeUser: AuthenticatedUser = {
      ...user,
      currentMembership: {
        staffId: 9,
        storeId: 2,
        role: 'staff',
        permissions: ['staff:view'],
        isActive: true,
        subjectType: 'sub_account',
        linkedEmployeeId: 12,
        subAccountId: 5,
        subAccountRole: 'finance',
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: false,
      },
    };
    const createdAt = new Date('2026-05-13T08:00:00.000Z');
    const updatedAt = new Date('2026-05-13T09:00:00.000Z');

    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 12,
      storeId: 2,
      linkedStaffId: null,
      departmentId: 3,
      positionId: 4,
      empNo: 'EMP012',
      name: '张三',
      phone: '13800138000',
      position: '收银员',
      department: '前厅',
      joinDate: new Date('2026-05-01T00:00:00.000Z'),
      baseSalary: 450000,
      avatar: null,
      idCard: null,
      gender: EmployeeGender.male,
      emergencyContact: null,
      emergencyPhone: null,
      contractEndDate: null,
      note: null,
      status: EmployeeStatus.active,
      resignDate: null,
      resignReason: null,
      createdAt,
      updatedAt,
    });
    employeesAccessService.buildEmployeeDetailCapabilities.mockReturnValue({
      canViewSubAccountModule: false,
      canResign: false,
    });
    prismaService.storeSubAccount.findMany.mockResolvedValue([
      {
        id: 7,
        employeeId: 12,
        slotIndex: 1,
        role: 'manager',
        status: 'active',
        canUseHandover: true,
        createdAt,
        updatedAt,
      },
    ]);
    prismaService.staff.findMany.mockResolvedValue([
      {
        id: 18,
        phone: '13800138000',
        email: 'account_store_mgr01@purelyprofit.local',
        loginAccount: 'store_mgr01',
        updatedAt,
        employeeProfile: { id: 12 },
        user: { password: 'hashed-password' },
      },
    ]);

    await expect(service.getDetail(financeUser, 12)).resolves.toEqual({
      id: '12',
      empNo: 'EMP012',
      name: '张三',
      phone: '13800138000',
      position: '收银员',
      department: '前厅',
      joinDate: new Date('2026-05-01T00:00:00.000Z').getTime(),
      baseSalary: 4500,
      gender: EmployeeGender.male,
      status: EmployeeStatus.active,
      createdAt: createdAt.getTime(),
      updatedAt: updatedAt.getTime(),
      canViewSubAccountModule: false,
      canResign: false,
    });
    expect(
      employeesAccessService.buildEmployeeDetailCapabilities,
    ).toHaveBeenCalledWith(financeUser, 2);
  });

  it('getDetail 对店长子账号隐藏子账号模块但允许办理离职', async () => {
    const managerUser: AuthenticatedUser = {
      ...user,
      currentMembership: {
        staffId: 10,
        storeId: 2,
        role: 'staff',
        permissions: ['staff:view', 'staff:update'],
        isActive: true,
        subjectType: 'sub_account',
        linkedEmployeeId: 12,
        subAccountId: 6,
        subAccountRole: 'manager',
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
      },
    };
    const createdAt = new Date('2026-05-13T08:00:00.000Z');
    const updatedAt = new Date('2026-05-13T09:00:00.000Z');

    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 15,
      storeId: 2,
      linkedStaffId: null,
      departmentId: 5,
      positionId: 6,
      empNo: 'EMP015',
      name: '李四',
      phone: '13800138002',
      position: '店长',
      department: '前厅',
      joinDate: new Date('2026-05-03T00:00:00.000Z'),
      baseSalary: 520000,
      avatar: null,
      idCard: null,
      gender: EmployeeGender.female,
      emergencyContact: null,
      emergencyPhone: null,
      contractEndDate: null,
      note: null,
      status: EmployeeStatus.active,
      resignDate: null,
      resignReason: null,
      createdAt,
      updatedAt,
    });
    employeesAccessService.buildEmployeeDetailCapabilities.mockReturnValue({
      canViewSubAccountModule: false,
      canResign: true,
    });
    prismaService.storeSubAccount.findMany.mockResolvedValue([
      {
        id: 9,
        employeeId: 15,
        slotIndex: 2,
        role: 'cashier',
        status: 'active',
        canUseHandover: true,
        createdAt,
        updatedAt,
      },
    ]);
    prismaService.staff.findMany.mockResolvedValue([
      {
        id: 19,
        phone: '13800138002',
        email: 'account_cashier_02@purelyprofit.local',
        updatedAt,
        employeeProfile: { id: 15 },
        user: { password: 'hashed-password' },
      },
    ]);

    await expect(service.getDetail(managerUser, 15)).resolves.toEqual({
      id: '15',
      empNo: 'EMP015',
      name: '李四',
      phone: '13800138002',
      position: '店长',
      department: '前厅',
      joinDate: new Date('2026-05-03T00:00:00.000Z').getTime(),
      baseSalary: 5200,
      gender: EmployeeGender.female,
      status: EmployeeStatus.active,
      createdAt: createdAt.getTime(),
      updatedAt: updatedAt.getTime(),
      canViewSubAccountModule: false,
      canResign: true,
    });
    expect(
      employeesAccessService.buildEmployeeDetailCapabilities,
    ).toHaveBeenCalledWith(managerUser, 2);
  });

  it('create 在会员员工额度不足时阻止新增', async () => {
    employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);
    platformMembershipAccessService.ensureEmployeeQuotaAvailable.mockRejectedValue(
      new ForbiddenException(
        '当前会员套餐最多可管理 0 名在职员工，请升级会员后继续添加',
      ),
    );

    await expect(
      service.create(user, {
        storeId: 2,
        name: '张三',
        phone: '13800138000',
        position: '店长',
        department: '前厅',
        joinDate: new Date('2026-05-01T00:00:00.000Z').getTime(),
        baseSalary: 5800,
        idCard: '110101199001011234',
        emergencyContact: '李四',
        emergencyPhone: '13800138001',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      platformMembershipAccessService.ensureEmployeeQuotaAvailable,
    ).toHaveBeenCalledWith(2);
    expect(prismaService.employee.create).not.toHaveBeenCalled();
  });

  it('create 会补齐部门职位、生成员工编号并规范化字段', async () => {
    const joinDate = new Date('2026-05-01T00:00:00.000Z').getTime();
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const updatedAt = new Date('2026-05-13T10:30:00.000Z');

    employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);
    platformMembershipAccessService.ensureEmployeeQuotaAvailable.mockResolvedValue(
      undefined,
    );
    prismaService.employeeDepartment.findFirst.mockResolvedValue(null);
    prismaService.employeeDepartment.create.mockResolvedValue({
      id: 8,
      storeId: 2,
      name: '前厅',
      createdAt,
      updatedAt,
    });
    prismaService.employeePosition.findFirst.mockResolvedValue(null);
    prismaService.employeePosition.create.mockResolvedValue({
      id: 9,
      storeId: 2,
      name: '店长',
      createdAt,
      updatedAt,
    });
    prismaService.employee.findFirst.mockResolvedValue({ empNo: 'EMP009' });
    const createdEmployee = {
      id: 10,
      storeId: 2,
      linkedStaffId: null,
      departmentId: 8,
      positionId: 9,
      empNo: 'EMP010',
      name: '张三',
      phone: '13800138000',
      position: '店长',
      department: '前厅',
      joinDate: new Date(joinDate),
      baseSalary: 480000,
      avatar: null,
      idCard: '110101199001011234',
      gender: EmployeeGender.unset,
      emergencyContact: '李四',
      emergencyPhone: '13800138001',
      contractEndDate: null,
      note: null,
      status: EmployeeStatus.active,
      resignDate: null,
      resignReason: null,
      createdAt,
      updatedAt,
    };
    prismaService.employee.create.mockResolvedValue(createdEmployee);

    // buildEmployeeDetail 会重新查询员工详情
    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue(
      createdEmployee,
    );
    prismaService.storeSubAccount.findMany.mockResolvedValue([]);
    prismaService.staff.findMany.mockResolvedValue([]);

    const result = await service.create(user, {
      storeId: 2,
      name: ' 张三 ',
      phone: ' 13800138000 ',
      position: ' 店长 ',
      department: ' 前厅 ',
      joinDate,
      baseSalary: 4800,
      idCard: '110101199001011234',
      emergencyContact: ' 李四 ',
      emergencyPhone: ' 13800138001 ',
      note: '   ',
    });

    expect(employeesAccessService.resolveSingleStoreId).toHaveBeenCalledWith(
      user,
      2,
      'staff:create',
    );
    expect(prismaService.employeeDepartment.create).toHaveBeenCalledWith({
      data: { storeId: 2, name: '前厅' },
    });
    expect(prismaService.employeePosition.create).toHaveBeenCalledWith({
      data: { storeId: 2, name: '店长' },
    });

    expect(prismaService.employee.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 2,
        departmentId: 8,
        positionId: 9,
        empNo: 'EMP010',
        name: '张三',
        phone: '13800138000',
        position: '店长',
        department: '前厅',
        joinDate: new Date(joinDate),
        baseSalary: 480000,
        idCard: '110101199001011234',
        gender: EmployeeGender.unset,
        emergencyContact: '李四',
        emergencyPhone: '13800138001',
        note: null,
        status: EmployeeStatus.active,
      }),
    });
    const createdEmployeeSalary =
      prismaService.employee.create.mock.calls.at(0)?.[0]?.data.baseSalary;
    expect(createdEmployeeSalary).toBe(480000);

    expect(result).toMatchObject({
      id: '10',
      empNo: 'EMP010',
      name: '张三',
      phone: '13800138000',
      position: '店长',
      department: '前厅',
      baseSalary: 4800,
      idCard: '110101199001011234',
      emergencyContact: '李四',
      emergencyPhone: '13800138001',
      status: EmployeeStatus.active,
    });
  });

  it('update 会同步排班请假和工资快照', async () => {
    const joinDate = new Date('2026-05-01T00:00:00.000Z');
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const updatedAt = new Date('2026-05-13T11:00:00.000Z');

    const previousEmployee = {
      id: 12,
      storeId: 2,
      linkedStaffId: null,
      departmentId: 3,
      positionId: 4,
      empNo: 'EMP012',
      name: '张三',
      phone: '13800138000',
      position: '收银员',
      department: '前厅',
      joinDate,
      baseSalary: 450000,
      avatar: null,
      idCard: null,
      gender: EmployeeGender.male,
      emergencyContact: null,
      emergencyPhone: null,
      contractEndDate: null,
      note: null,
      status: EmployeeStatus.active,
      resignDate: null,
      resignReason: null,
      createdAt,
      updatedAt: createdAt,
    };
    const updatedEmployee = {
      ...previousEmployee,
      name: '王五',
      baseSalary: 520000,
      updatedAt,
    };
    // 第一次调用给 write service，第二次给 buildEmployeeDetail
    employeesAccessService.findManageableEmployeeOrThrow
      .mockResolvedValueOnce(previousEmployee)
      .mockResolvedValueOnce(updatedEmployee);
    prismaService.storeSubAccount.findMany.mockResolvedValue([]);
    prismaService.staff.findMany.mockResolvedValue([]);
    prismaService.employee.update.mockResolvedValue({
      id: 12,
      storeId: 2,
      linkedStaffId: null,
      departmentId: 3,
      positionId: 4,
      empNo: 'EMP012',
      name: '王五',
      phone: '13800138000',
      position: '收银员',
      department: '前厅',
      joinDate,
      baseSalary: 520000,
      avatar: null,
      idCard: null,
      gender: EmployeeGender.male,
      emergencyContact: null,
      emergencyPhone: null,
      contractEndDate: null,
      note: null,
      status: EmployeeStatus.active,
      resignDate: null,
      resignReason: null,
      createdAt,
      updatedAt,
    });
    prismaService.employeeLeave.updateMany.mockResolvedValue({ count: 1 });
    prismaService.employeeShift.updateMany.mockResolvedValue({ count: 2 });
    prismaService.employeePayroll.findMany.mockResolvedValue([
      {
        id: 21,
        month: new Date('2026-05-01T00:00:00.000Z'),
        status: EmployeePayrollStatus.confirmed,
        leaveDeduction: 100,
        otherDeduction: 50,
        otherDeductionNote: '迟到',
        bonus: 200,
        socialInsurance: 30000,
        housingFund: 0,
        note: null,
      },
    ]);
    prismaService.employeePayroll.update.mockResolvedValue({
      id: 21,
      employeeId: 12,
      employeeName: '王五',
      month: new Date('2026-05-01T00:00:00.000Z'),
      baseSalary: 5200,
      leaveDeduction: 100,
      otherDeduction: 50,
      otherDeductionNote: '迟到',
      bonus: 200,
      actualSalary: 5250,
      socialInsurance: 30000,
      housingFund: 0,
      totalLaborCost: 55500,
      status: EmployeePayrollStatus.draft,
      confirmedAt: null,
      note: null,
      createdAt,
      updatedAt,
    });
    prismaService.employeePayroll.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.update(user, 12, {
      name: ' 王五 ',
      baseSalary: 5200,
    });

    expect(prismaService.employee.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: {
        name: '王五',
        baseSalary: 520000,
      },
    });
    const updatedSalary =
      prismaService.employee.update.mock.calls.at(0)?.[0]?.data.baseSalary;
    expect(updatedSalary).toBe(520000);
    expect(prismaService.employeeLeave.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 12 },
      data: { employeeName: '王五' },
    });
    expect(prismaService.employeeShift.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 12 },
      data: { employeeName: '王五' },
    });
    expect(prismaService.employeePayroll.findMany).toHaveBeenCalledWith({
      where: { employeeId: 12 },
      select: {
        id: true,
        month: true,
        status: true,
        leaveDeduction: true,
        otherDeduction: true,
        otherDeductionNote: true,
        bonus: true,
        socialInsurance: true,
        housingFund: true,
        note: true,
      },
    });
    expect(costsService.syncPayrollCosts).toHaveBeenCalledWith(prismaService, {
      storeId: 2,
      payrollId: 21,
      operatorStaffId: null,
      employeeName: '王五',
      month: '2026-05',
      actualSalary: 5200.5,
      socialInsurance: 300,
      housingFund: undefined,
      note: null,
    });
    expect(prismaService.employeePayroll.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: {
        baseSalary: 520000,
        actualSalary: 520050,
        totalLaborCost: 550050,
      },
    });
    expect(prismaService.employeePayroll.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 12 },
      data: { employeeName: '王五' },
    });
    expect(result).toMatchObject({
      id: '12',
      name: '王五',
      baseSalary: 5200,
    });
  });

  it('update 仅改名不改底薪时同步 cost_records.title 里的员工姓名快照', async () => {
    const joinDate = new Date('2026-05-01T00:00:00.000Z');
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const updatedAt = new Date('2026-05-13T11:00:00.000Z');

    const previousEmployee = {
      id: 12,
      storeId: 2,
      linkedStaffId: null,
      departmentId: 3,
      positionId: 4,
      empNo: 'EMP012',
      name: '张三',
      phone: '13800138000',
      position: '收银员',
      department: '前厅',
      joinDate,
      baseSalary: 450000,
      avatar: null,
      idCard: null,
      gender: EmployeeGender.male,
      emergencyContact: null,
      emergencyPhone: null,
      contractEndDate: null,
      note: null,
      status: EmployeeStatus.active,
      resignDate: null,
      resignReason: null,
      createdAt,
      updatedAt: createdAt,
    };
    const updatedEmployee = {
      ...previousEmployee,
      name: '李明',
      updatedAt,
    };
    // 第一次调用给 write service，第二次给 buildEmployeeDetail
    employeesAccessService.findManageableEmployeeOrThrow
      .mockResolvedValueOnce(previousEmployee)
      .mockResolvedValueOnce(updatedEmployee);
    prismaService.storeSubAccount.findMany.mockResolvedValue([]);
    prismaService.staff.findMany.mockResolvedValue([]);
    prismaService.employee.update.mockResolvedValue({
      id: 12,
      storeId: 2,
      linkedStaffId: null,
      departmentId: 3,
      positionId: 4,
      empNo: 'EMP012',
      name: '李明',
      phone: '13800138000',
      position: '收银员',
      department: '前厅',
      joinDate,
      baseSalary: 450000,
      avatar: null,
      idCard: null,
      gender: EmployeeGender.male,
      emergencyContact: null,
      emergencyPhone: null,
      contractEndDate: null,
      note: null,
      status: EmployeeStatus.active,
      resignDate: null,
      resignReason: null,
      createdAt,
      updatedAt,
    });
    prismaService.employeeLeave.updateMany.mockResolvedValue({ count: 1 });
    prismaService.employeeShift.updateMany.mockResolvedValue({ count: 1 });
    prismaService.employeePayroll.updateMany.mockResolvedValue({ count: 1 });
    prismaService.$queryRaw.mockResolvedValue([]);
    prismaService.$executeRaw.mockResolvedValue(2);

    const result = await service.update(user, 12, { name: '李明' });

    // 验证姓名快照同步
    expect(prismaService.employeeLeave.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 12 },
      data: { employeeName: '李明' },
    });
    expect(prismaService.employeeShift.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 12 },
      data: { employeeName: '李明' },
    });
    expect(prismaService.employeePayroll.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 12 },
      data: { employeeName: '李明' },
    });
    // 验证 cost_records.title 同步：当无关联成本记录时不会触发 $executeRaw
    expect(prismaService.$queryRaw).toHaveBeenCalled();
    // 底薪未变，不应该重算工资
    expect(prismaService.employeePayroll.findMany).not.toHaveBeenCalled();
    expect(costsService.syncPayrollCosts).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: '12',
      name: '李明',
    });
  });

  it('updateDepartment 会同步更新关联员工的部门名称', async () => {
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const updatedAt = new Date('2026-05-13T10:20:00.000Z');

    prismaService.employeeDepartment.findUnique.mockResolvedValue({
      id: 3,
      storeId: 2,
      name: '前厅',
      createdAt,
      updatedAt,
    });
    employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
      undefined,
    );
    prismaService.employeeDepartment.findFirst.mockResolvedValue(null);
    prismaService.employeeDepartment.update.mockResolvedValue({
      id: 3,
      storeId: 2,
      name: '门店前厅',
      createdAt,
      updatedAt,
    });
    prismaService.employee.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.updateDepartment(user, 3, {
      name: ' 门店前厅 ',
    });

    expect(
      employeesAccessService.ensureCanManageEmployees,
    ).toHaveBeenCalledWith(user, 2, 'staff:update');
    expect(prismaService.employeeDepartment.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { name: '门店前厅' },
    });
    expect(prismaService.employee.updateMany).toHaveBeenCalledWith({
      where: { departmentId: 3 },
      data: { department: '门店前厅' },
    });
    expect(result).toEqual({
      id: '3',
      name: '门店前厅',
      createdAt: createdAt.getTime(),
      updatedAt: updatedAt.getTime(),
    });
  });

  it('removeDepartment 在存在关联员工时会阻止删除', async () => {
    prismaService.employeeDepartment.findUnique.mockResolvedValue({
      id: 3,
      storeId: 2,
      _count: { employees: 1 },
    });
    employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
      undefined,
    );

    await expect(service.removeDepartment(user, 3)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prismaService.employeeDepartment.delete).not.toHaveBeenCalled();
  });

  it('listDepartments 会自动补齐默认综合部', async () => {
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const updatedAt = new Date('2026-05-13T10:20:00.000Z');

    employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);
    // #21 修复：ensureDefaultDepartment 现在先 count 再创建
    prismaService.employeeDepartment.count.mockResolvedValue(0);
    prismaService.employeeDepartment.findFirst.mockResolvedValue(null);
    prismaService.employeeDepartment.create.mockResolvedValue({
      id: 1,
      storeId: 2,
      name: '综合部',
      createdAt,
      updatedAt,
    });
    prismaService.employeeDepartment.findMany.mockResolvedValue([
      {
        id: 1,
        storeId: 2,
        name: '综合部',
        createdAt,
        updatedAt,
      },
    ]);

    const result = await service.listDepartments(user, {});

    expect(employeesAccessService.resolveSingleStoreId).toHaveBeenCalledWith(
      user,
      undefined,
      'staff:view',
    );
    expect(prismaService.employeeDepartment.create).toHaveBeenCalledWith({
      data: { storeId: 2, name: '综合部' },
    });
    expect(result).toEqual([
      {
        id: '1',
        name: '综合部',
        createdAt: createdAt.getTime(),
        updatedAt: updatedAt.getTime(),
      },
    ]);
  });

  it('createDepartment 在 storeId 缺失时会自动推断当前门店', async () => {
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const updatedAt = new Date('2026-05-13T10:20:00.000Z');

    employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);
    prismaService.employeeDepartment.findFirst.mockResolvedValue(null);
    prismaService.employeeDepartment.create.mockResolvedValue({
      id: 4,
      storeId: 2,
      name: '前厅',
      createdAt,
      updatedAt,
    });

    const result = await service.createDepartment(user, {
      name: ' 前厅 ',
    });

    expect(employeesAccessService.resolveSingleStoreId).toHaveBeenCalledWith(
      user,
      undefined,
      'staff:create',
    );
    expect(prismaService.employeeDepartment.create).toHaveBeenCalledWith({
      data: { storeId: 2, name: '前厅' },
    });
    expect(result).toEqual({
      id: '4',
      name: '前厅',
      createdAt: createdAt.getTime(),
      updatedAt: updatedAt.getTime(),
    });
  });

  it('createDepartment 在同名部门已存在时会抛出冲突异常', async () => {
    employeesAccessService.resolveSingleStoreId.mockResolvedValue(2);
    prismaService.employeeDepartment.findFirst.mockResolvedValue({
      id: 4,
      storeId: 2,
      name: '前厅',
    });

    await expect(
      service.createDepartment(user, {
        name: ' 前厅 ',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaService.employeeDepartment.create).not.toHaveBeenCalled();
  });

  it('updateLeave 会按传入字段更新请假记录', async () => {
    const createdAt = new Date('2026-05-13T08:00:00.000Z');

    prismaService.employeeLeave.findUnique.mockResolvedValue({
      id: 31,
      storeId: 2,
      employeeId: 5,
      startDate: new Date('2026-05-05T00:00:00.000Z'),
      endDate: new Date('2026-05-05T00:00:00.000Z'),
      days: new Prisma.Decimal('1'),
      deductSalary: true,
      deductAmount: 5000,
    });
    employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
      undefined,
    );
    prismaService.employeeLeave.findFirst.mockResolvedValue(null);
    prismaService.employeeLeave.update.mockResolvedValue({
      id: 31,
      storeId: 2,
      employeeId: 5,
      employeeName: '王五',
      type: 'sick',
      startDate: new Date('2026-05-06T00:00:00.000Z'),
      endDate: new Date('2026-05-07T00:00:00.000Z'),
      days: new Prisma.Decimal('3'),
      deductSalary: false,
      deductAmount: 0,
      note: null,
      createdAt,
    });

    const result = await service.updateLeave(user, 31, {
      type: 'sick',
      startDate: new Date('2026-05-06T00:00:00.000Z').getTime(),
      endDate: new Date('2026-05-07T00:00:00.000Z').getTime(),
      deductSalary: false,
      deductAmount: 0,
      note: '   ',
    });

    expect(
      employeesAccessService.ensureCanManageEmployees,
    ).toHaveBeenCalledWith(user, 2, 'staff:update');
    expect(prismaService.employeeLeave.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: {
        type: 'sick',
        startDate: new Date('2026-05-06T00:00:00.000Z'),
        endDate: new Date('2026-05-07T00:00:00.000Z'),
        days: 3,
        deductSalary: false,
        deductAmount: 0,
        note: null,
      },
    });
    expect(result).toEqual({
      id: '31',
      employeeId: '5',
      employeeName: '王五',
      type: 'sick',
      startDate: new Date('2026-05-06T00:00:00.000Z').getTime(),
      endDate: new Date('2026-05-07T00:00:00.000Z').getTime(),
      days: 3,
      deductSalary: false,
      deductAmount: 0,
      createdAt: createdAt.getTime(),
    });
  });

  it('updateShift 会按传入字段更新排班记录', async () => {
    const createdAt = new Date('2026-05-13T08:00:00.000Z');

    prismaService.employeeShift.findUnique.mockResolvedValue({
      id: 41,
      storeId: 2,
      employeeId: 5,
      date: new Date('2026-05-08T00:00:00.000Z'),
      startTime: '09:00',
      endTime: '18:00',
    });
    employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
      undefined,
    );
    prismaService.employeeShift.findMany.mockResolvedValue([]);
    employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockResolvedValue(
      {
        id: 9,
        name: '晚班',
        defaultStartTime: '17:30',
        defaultEndTime: '23:30',
      },
    );
    prismaService.employeeShift.update.mockResolvedValue({
      id: 41,
      storeId: 2,
      employeeId: 5,
      employeeName: '王五',
      date: new Date('2026-05-08T00:00:00.000Z'),
      shiftType: null,
      shiftDefinitionId: 9,
      shiftName: '晚班',
      startTime: '17:30',
      endTime: '23:30',
      note: null,
      createdAt,
    });

    const result = await service.updateShift(user, 41, {
      date: new Date('2026-05-08T00:00:00.000Z').getTime(),
      shiftDefinitionId: 9,
      note: '   ',
    });

    expect(
      employeesAccessService.ensureCanManageEmployees,
    ).toHaveBeenCalledWith(user, 2, 'staff:update');
    expect(prismaService.employeeShift.update).toHaveBeenCalledWith({
      where: { id: 41 },
      data: {
        date: new Date('2026-05-08T00:00:00.000Z'),
        shiftType: 'custom',
        shiftDefinitionId: 9,
        shiftName: '晚班',
        startTime: '17:30',
        endTime: '23:30',
        note: null,
      },
    });
    expect(result).toEqual({
      id: '41',
      employeeId: '5',
      employeeName: '王五',
      date: new Date('2026-05-08T00:00:00.000Z').getTime(),
      shiftDefinitionId: '9',
      shiftName: '晚班',
      startTime: '17:30',
      endTime: '23:30',
      createdAt: createdAt.getTime(),
    });
  });

  it('createLeave 在时间段与已有请假记录冲突时抛出异常', async () => {
    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 5,
      storeId: 2,
      name: '王五',
    });
    prismaService.employeeLeave.findFirst.mockResolvedValue({ id: 99 });

    await expect(
service.createLeave(user, 5, {
      type: 'sick',
      startDate: new Date('2026-05-08T00:00:00.000Z').getTime(),
      endDate: new Date('2026-05-09T00:00:00.000Z').getTime(),
      deductSalary: true,
      deductAmount: 50,
    }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaService.employeeLeave.create).not.toHaveBeenCalled();
  });

  it('createLeave 在开始时间晚于结束时间时抛出异常', async () => {
    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 5,
      storeId: 2,
      name: '王五',
    });

    await expect(
service.createLeave(user, 5, {
      type: 'sick',
      startDate: new Date('2026-05-08T00:00:00.000Z').getTime(),
      endDate: new Date('2026-05-07T00:00:00.000Z').getTime(),
      deductSalary: false,
      deductAmount: 0,
    }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaService.employeeLeave.create).not.toHaveBeenCalled();
  });

  it('createShift 允许同员工同日创建非重叠排班', async () => {
    const createdAt = new Date('2026-05-13T08:00:00.000Z');

    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 5,
      storeId: 2,
      name: '王五',
    });
    prismaService.employeeShift.findMany.mockResolvedValue([
      {
        id: 81,
        startTime: '09:00',
        endTime: '12:00',
      },
    ]);

    employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockResolvedValue(
      {
        id: 9,
        name: '晚班',
        defaultStartTime: '13:00',
        defaultEndTime: '18:00',
      },
    );
    prismaService.employeeShift.create.mockResolvedValue({
      id: 83,
      storeId: 2,
      employeeId: 5,
      employeeName: '王五',
      date: new Date('2026-05-08T00:00:00.000Z'),
      shiftType: null,
      shiftDefinitionId: 9,
      shiftName: '晚班',
      startTime: '13:00',
      endTime: '18:00',
      note: null,
      createdAt,
    });

    await expect(
      service.createShift(user, {
        employeeId: 5,
        date: new Date('2026-05-08T00:00:00.000Z').getTime(),
        shiftDefinitionId: 9,
      }),
    ).resolves.toEqual({
      id: '83',
      employeeId: '5',
      employeeName: '王五',
      date: new Date('2026-05-08T00:00:00.000Z').getTime(),
      shiftDefinitionId: '9',
      shiftName: '晚班',
      startTime: '13:00',
      endTime: '18:00',
      createdAt: createdAt.getTime(),
    });
  });

  it('createShift 在同一天时间重叠时抛出异常', async () => {
    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 5,
      storeId: 2,
      name: '王五',
    });
    prismaService.employeeShift.findMany.mockResolvedValue([
      {
        id: 82,
        startTime: '10:00',
        endTime: '14:00',
      },
    ]);

    employeesShiftDefinitionService.findShiftDefinitionForStoreOrThrow.mockResolvedValue(
      {
        id: 9,
        name: '晚班',
        defaultStartTime: '13:30',
        defaultEndTime: '18:00',
      },
    );

    await expect(
      service.createShift(user, {
        employeeId: 5,
        date: new Date('2026-05-08T00:00:00.000Z').getTime(),
        shiftDefinitionId: 9,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaService.employeeShift.create).not.toHaveBeenCalled();
  });

  it('updateShift 仅更新备注时保留原有班次时间', async () => {
    const createdAt = new Date('2026-05-13T08:00:00.000Z');

    prismaService.employeeShift.findUnique.mockResolvedValue({
      id: 41,
      storeId: 2,
      employeeId: 5,
      date: new Date('2026-05-08T00:00:00.000Z'),
      startTime: '09:00',
      endTime: '18:00',
    });
    employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
      undefined,
    );
    prismaService.employeeShift.findMany.mockResolvedValue([]);
    prismaService.employeeShift.update.mockResolvedValue({
      id: 41,
      storeId: 2,
      employeeId: 5,
      employeeName: '王五',
      date: new Date('2026-05-08T00:00:00.000Z'),
      shiftType: null,
      shiftDefinitionId: 1,
      shiftName: '早班',
      startTime: '09:00',
      endTime: '18:00',
      note: '只更新备注',
      createdAt,
    });

    // 不传 shiftDefinitionId 时保留原有时间，只更新备注
    await expect(
      service.updateShift(user, 41, {
        note: '只更新备注',
      }),
    ).resolves.toBeDefined();

    expect(prismaService.employeeShift.update).toHaveBeenCalledWith({
      where: { id: 41 },
      data: {
        note: '只更新备注',
      },
    });
  });

  it('listPayrolls 在按全年筛选时会返回整年工资记录', async () => {
    const createdAt = new Date('2026-05-13T08:00:00.000Z');
    const updatedAt = new Date('2026-05-13T09:00:00.000Z');

    employeesAccessService.getManageableStoreId.mockReturnValue(2);
    prismaService.employeePayroll.findMany.mockResolvedValue([
      {
        id: 21,
        storeId: 2,
        employeeId: 5,
        employeeName: '王五',
        month: new Date('2026-05-01T00:00:00.000Z'),
        baseSalary: 500000,
        leaveDeduction: 12000,
        otherDeduction: 8000,
        otherDeductionNote: '迟到罚款',
        bonus: 30000,
        actualSalary: 510000,
        socialInsurance: 40000,
        housingFund: 0,
        totalLaborCost: 550000,
        status: EmployeePayrollStatus.draft,
        confirmedAt: null,
        note: '含季度奖励',
        createdAt,
        updatedAt,
      },
    ]);
    prismaService.employeePayroll.count.mockResolvedValue(1);

    const result = await service.listPayrolls(user, {
      storeId: 2,
      year: 2026,
      month: 0,
      department: '前厅',
    });

    expect(prismaService.employeePayroll.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 2,
        month: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lt: new Date('2027-01-01T00:00:00.000Z'),
        },
        employee: {
          department: { equals: '前厅', mode: 'insensitive' },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 50,
    });
    expect(result).toEqual({
      items: [
        {
          id: '21',
          employeeId: '5',
          employeeName: '王五',
          month: '2026-05',
          baseSalary: 5000,
          leaveDeduction: 120,
          otherDeduction: 80,
          otherDeductionNote: '迟到罚款',
          bonus: 300,
          actualSalary: 5100,
          socialInsurance: 400,
          totalLaborCost: 5500,
          status: EmployeePayrollStatus.draft,
          note: '含季度奖励',
          createdAt: createdAt.getTime(),
          updatedAt: updatedAt.getTime(),
        },
      ],
      meta: {
        page: 1,
        pageSize: 50,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('listPayrolls 在无 finance:view 权限时返回空数组而非 403', async () => {
    employeesAccessService.getManageableStoreId.mockReturnValue(null);

    const result = await service.listPayrolls(user, { storeId: 2 });

    expect(result).toEqual({
      items: [],
      meta: {
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 1,
      },
    });
    expect(prismaService.employeePayroll.findMany).not.toHaveBeenCalled();
  });

  it('listPayrolls 在 storeId 与可管理门店不匹配时返回空数组', async () => {
    employeesAccessService.getManageableStoreId.mockReturnValue(2);

    const result = await service.listPayrolls(user, { storeId: 99 });

    expect(result).toEqual({
      items: [],
      meta: {
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 1,
      },
    });
    expect(prismaService.employeePayroll.findMany).not.toHaveBeenCalled();
  });

  it('savePayroll 在存在其他扣款但缺少说明时抛出异常', async () => {
    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 5,
      storeId: 2,
      name: '王五',
    });

    await expect(
      service.savePayroll(user, {
        employeeId: 5,
        month: '2026-04',
        baseSalary: 5000,
        leaveDeduction: 120,
        otherDeduction: 80,
        bonus: 300,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaService.employeePayroll.upsert).not.toHaveBeenCalled();
  });

  it('savePayroll 在实发工资为负数时抛出异常', async () => {
    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 5,
      storeId: 2,
      name: '王五',
    });

    await expect(
      service.savePayroll(user, {
        employeeId: 5,
        month: '2026-04',
        baseSalary: 1000,
        leaveDeduction: 900,
        otherDeduction: 300,
        otherDeductionNote: '罚款',
        bonus: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaService.employeePayroll.upsert).not.toHaveBeenCalled();
  });

  it('savePayroll 会计算工资汇总并重置确认状态', async () => {
    const createdAt = new Date('2026-05-13T08:00:00.000Z');
    const updatedAt = new Date('2026-05-13T09:00:00.000Z');

    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 5,
      storeId: 2,
      name: '王五',
      linkedStaffId: 12,
    });
    prismaService.employeePayroll.findUnique.mockResolvedValue(null);
    prismaService.employeePayroll.upsert.mockResolvedValue({
      id: 21,
      storeId: 2,
      employeeId: 5,
      employeeName: '王五',
      month: new Date('2026-04-01T00:00:00.000Z'),
      baseSalary: 500000,
      leaveDeduction: 12000,
      otherDeduction: 8000,
      otherDeductionNote: '迟到罚款',
      bonus: 30000,
      actualSalary: 510000,
      socialInsurance: 40000,
      housingFund: 0,
      totalLaborCost: 550000,
      status: EmployeePayrollStatus.draft,
      confirmedAt: null,
      note: '含季度奖励',
      createdAt,
      updatedAt,
    });

    const result = await service.savePayroll(user, {
      employeeId: 5,
      month: ' 2026-04 ',
      baseSalary: 5000,
      leaveDeduction: 120,
      otherDeduction: 80,
      otherDeductionNote: ' 迟到罚款 ',
      bonus: 300,
      socialInsurance: 400,
      note: ' 含季度奖励 ',
    });

    expect(
      employeesAccessService.findManageableEmployeeOrThrow,
    ).toHaveBeenCalledWith(user, 5, 'finance:manage');
    expect(prismaService.employeePayroll.upsert).toHaveBeenCalledWith({
      where: {
        employeeId_month: {
          employeeId: 5,
          month: new Date('2026-04-01T00:00:00.000Z'),
        },
      },
      create: expect.objectContaining({
        storeId: 2,
        employeeId: 5,
        employeeName: '王五',
        month: new Date('2026-04-01T00:00:00.000Z'),
        baseSalary: 500000,
        leaveDeduction: 12000,
        otherDeduction: 8000,
        otherDeductionNote: '迟到罚款',
        bonus: 30000,
        actualSalary: 510000,
        socialInsurance: 40000,
        housingFund: undefined,
        totalLaborCost: 550000,
        status: EmployeePayrollStatus.draft,
        note: '含季度奖励',
      }),
      update: expect.objectContaining({
        employeeName: '王五',
        baseSalary: 500000,
        leaveDeduction: 12000,
        otherDeduction: 8000,
        otherDeductionNote: '迟到罚款',
        bonus: 30000,
        actualSalary: 510000,
        socialInsurance: 40000,
        totalLaborCost: 550000,
        status: EmployeePayrollStatus.draft,
        confirmedAt: null,
        note: '含季度奖励',
      }),
    });
    expect(costsService.syncPayrollCosts).not.toHaveBeenCalled();

    expect(result).toEqual({
      id: '21',
      employeeId: '5',
      employeeName: '王五',
      month: '2026-04',
      baseSalary: 5000,
      leaveDeduction: 120,
      otherDeduction: 80,
      otherDeductionNote: '迟到罚款',
      bonus: 300,
      actualSalary: 5100,
      socialInsurance: 400,
      totalLaborCost: 5500,
      status: EmployeePayrollStatus.draft,
      note: '含季度奖励',
      createdAt: createdAt.getTime(),
      updatedAt: updatedAt.getTime(),
    });
  });

  it('confirmPayroll 会将工资记录更新为已确认', async () => {
    const confirmedAt = new Date('2026-05-14T12:00:00.000Z');
    const createdAt = new Date('2026-05-13T08:00:00.000Z');
    const updatedAt = new Date('2026-05-14T12:00:00.000Z');

    prismaService.employeePayroll.findUnique.mockResolvedValue({
      id: 21,
      storeId: 2,
      status: EmployeePayrollStatus.draft,
    });
    employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
      undefined,
    );
    prismaService.employeePayroll.update.mockResolvedValue({
      id: 21,
      storeId: 2,
      employeeId: 5,
      employeeName: '王五',
      month: new Date('2026-04-01T00:00:00.000Z'),
      baseSalary: 500000,
      leaveDeduction: 12000,
      otherDeduction: 8000,
      otherDeductionNote: null,
      bonus: 30000,
      actualSalary: 510000,
      socialInsurance: 0,
      housingFund: 0,
      totalLaborCost: 510000,
      status: EmployeePayrollStatus.confirmed,
      confirmedAt,
      note: null,
      createdAt,
      updatedAt,
    });

    const result = await service.confirmPayroll(user, 21);

    expect(
      employeesAccessService.ensureCanManageEmployees,
    ).toHaveBeenCalledWith(user, 2, 'finance:manage');
    const payrollUpdateArgs =
      prismaService.employeePayroll.update.mock.calls.at(0)?.[0] as {
        where: { id: number };
        data: { status: EmployeePayrollStatus; confirmedAt: Date };
      };
    expect(payrollUpdateArgs.where).toEqual({ id: 21 });
    expect(payrollUpdateArgs.data.status).toBe(EmployeePayrollStatus.confirmed);
    expect(payrollUpdateArgs.data.confirmedAt).toBeInstanceOf(Date);
    expect(costsService.syncPayrollCosts).toHaveBeenCalledWith(
      prismaService,
      expect.objectContaining({
        storeId: 2,
        payrollId: 21,
        operatorStaffId: null,
        employeeName: '王五',
        month: '2026-04',
        actualSalary: 5100,
        socialInsurance: undefined,
        housingFund: undefined,
      }),
    );
    expect(result.status).toBe(EmployeePayrollStatus.confirmed);
    expect(result.confirmedAt).toBe(confirmedAt.getTime());
  });

  it('confirmPayroll 在记录已确认时抛出异常', async () => {
    prismaService.employeePayroll.findUnique.mockResolvedValue({
      id: 21,
      storeId: 2,
      status: EmployeePayrollStatus.confirmed,
    });
    employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
      undefined,
    );

    await expect(service.confirmPayroll(user, 21)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prismaService.employeePayroll.update).not.toHaveBeenCalled();
  });

  it('confirmPayroll 在记录不存在时抛出异常', async () => {
    prismaService.employeePayroll.findUnique.mockResolvedValue(null);

    await expect(service.confirmPayroll(user, 999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prismaService.employeePayroll.update).not.toHaveBeenCalled();
  });

  it('updatePayroll 会按传入字段更新工资草稿并重新计算派生金额', async () => {
    const createdAt = new Date('2026-05-13T08:00:00.000Z');
    const updatedAt = new Date('2026-05-13T10:00:00.000Z');

    prismaService.employeePayroll.findUnique.mockResolvedValue({
      id: 1,
      storeId: 2,
      employeeId: 5,
      employeeName: '王五',
      month: new Date('2026-05-01T00:00:00.000Z'),
      baseSalary: 400000,
      leaveDeduction: 0,
      otherDeduction: 0,
      otherDeductionNote: null,
      bonus: 0,
      actualSalary: 400000,
      socialInsurance: 0,
      housingFund: 0,
      totalLaborCost: 400000,
      status: EmployeePayrollStatus.draft,
      confirmedAt: null,
      note: null,
      createdAt,
      updatedAt,
    });
    employeesAccessService.ensureCanManageEmployees.mockResolvedValue(undefined);
    prismaService.employeePayroll.update.mockResolvedValue({
      id: 1,
      storeId: 2,
      employeeId: 5,
      employeeName: '王五',
      month: new Date('2026-05-01T00:00:00.000Z'),
      baseSalary: 333200,
      leaveDeduction: 3200,
      otherDeduction: 4200,
      otherDeductionNote: '76',
      bonus: 5200,
      actualSalary: 331000,
      socialInsurance: 6200,
      housingFund: 7200,
      totalLaborCost: 344400,
      status: EmployeePayrollStatus.draft,
      confirmedAt: null,
      note: '5675',
      createdAt,
      updatedAt,
    });

    const result = await service.updatePayroll(user, 1, {
      baseSalary: 3332,
      leaveDeduction: 32,
      otherDeduction: 42,
      otherDeductionNote: '76',
      bonus: 52,
      socialInsurance: 62,
      housingFund: 72,
      note: '5675',
      actualSalary: 3310,
      totalLaborCost: 3444,
      status: EmployeePayrollStatus.draft,
    });

    expect(
      employeesAccessService.ensureCanManageEmployees,
    ).toHaveBeenCalledWith(user, 2, 'finance:manage');

    const updateArgs = prismaService.employeePayroll.update.mock.calls.at(
      0,
    )?.[0] as { where: { id: number }; data: Record<string, number | string | null> };
    expect(updateArgs.where).toEqual({ id: 1 });
    // 服务端重新计算实发工资 = 3332 - 32 - 42 + 52 = 3310 元 → 331000 分
    expect(updateArgs.data.actualSalary).toBe(331000);
    // 人力总成本 = 3310 + 62 + 72 = 3444 元 → 344400 分
    expect(updateArgs.data.totalLaborCost).toBe(344400);
    expect(updateArgs.data.baseSalary).toBe(333200);
    expect(updateArgs.data.otherDeductionNote).toBe('76');

    expect(result.actualSalary).toBe(3310);
    expect(result.totalLaborCost).toBe(3444);
    expect(result.status).toBe(EmployeePayrollStatus.draft);
    expect(
      cacheInvalidatorService.invalidateProfitDashboardHome,
    ).toHaveBeenCalledWith(2);
  });

  it('updatePayroll 在记录已确认时阻止编辑', async () => {
    prismaService.employeePayroll.findUnique.mockResolvedValue({
      id: 1,
      storeId: 2,
      status: EmployeePayrollStatus.confirmed,
    });
    employeesAccessService.ensureCanManageEmployees.mockResolvedValue(undefined);

    await expect(
      service.updatePayroll(user, 1, { baseSalary: 5000 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaService.employeePayroll.update).not.toHaveBeenCalled();
  });

  it('updatePayroll 在记录不存在时抛出异常', async () => {
    prismaService.employeePayroll.findUnique.mockResolvedValue(null);

    await expect(
      service.updatePayroll(user, 999, { baseSalary: 5000 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaService.employeePayroll.update).not.toHaveBeenCalled();
  });

  it('getShiftReport 会按前端报表结构聚合排班数据', async () => {
    employeesAccessService.resolveViewStoreId.mockResolvedValue(2);
    prismaService.employeeShift.findMany.mockResolvedValue([
      {
        id: 11,
        employeeId: 5,
        employeeName: '王五',
        date: new Date('2026-05-01T00:00:00.000Z'),
        shiftDefinitionId: 1,
        shiftName: '早班',
        startTime: '08:00',
        endTime: '14:00',
      },
      {
        id: 12,
        employeeId: 5,
        employeeName: '王五',
        date: new Date('2026-05-02T00:00:00.000Z'),
        shiftDefinitionId: null,
        shiftName: '自定义',
        startTime: '10:00',
        endTime: '16:00',
      },
      {
        id: 13,
        employeeId: 9,
        employeeName: '李四',
        date: new Date('2026-05-03T00:00:00.000Z'),
        shiftDefinitionId: 2,
        shiftName: '晚班',
        startTime: '17:00',
        endTime: '23:00',
      },
    ]);

    await expect(
      service.getShiftReport(user, {
        storeId: 2,
        year: 2026,
        month: 5,
        department: '前厅',
      }),
    ).resolves.toEqual({
      summary: {
        totalShifts: 3,
        employeeCount: 2,
        definitionCounts: [
          {
            shiftDefinitionId: '1',
            shiftName: '早班',
            count: 1,
          },
          {
            shiftDefinitionId: '2',
            shiftName: '晚班',
            count: 1,
          },
          {
            shiftName: '自定义',
            count: 1,
          },
        ],
      },
      rows: [
        {
          id: '11',
          dateLabel: '05/01 周五',
          employeeName: '王五',
          shiftDefinitionId: '1',
          shiftName: '早班',
          startTime: '08:00',
          endTime: '14:00',
        },
        {
          id: '12',
          dateLabel: '05/02 周六',
          employeeName: '王五',
          shiftName: '自定义',
          startTime: '10:00',
          endTime: '16:00',
        },
        {
          id: '13',
          dateLabel: '05/03 周日',
          employeeName: '李四',
          shiftDefinitionId: '2',
          shiftName: '晚班',
          startTime: '17:00',
          endTime: '23:00',
        },
      ],
    });

    expect(employeesAccessService.resolveViewStoreId).toHaveBeenCalledWith(
      user,
      2,
      '无权查看该门店排班报表',
      'report:view',
    );
    expect(prismaService.employeeShift.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 2,
        date: {
          gte: new Date(Date.UTC(2026, 4, 1, 0, 0, 0, 0)),
          lt: new Date(Date.UTC(2026, 5, 1, 0, 0, 0, 0)),
        },
        employee: {
          department: { equals: '前厅', mode: 'insensitive' },
        },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        date: true,
        employeeId: true,
        employeeName: true,
        shiftDefinitionId: true,
        shiftName: true,
        startTime: true,
        endTime: true,
      },
    });
  });

  it('updateSubAccount 支持 cashier 角色并返回收银员子账号摘要', async () => {
    const createdAt = new Date('2026-05-13T08:00:00.000Z');
    const updatedAt = new Date('2026-05-13T09:00:00.000Z');

    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 12,
      storeId: 2,
      linkedStaffId: null,
      empNo: 'EMP012',
      name: '张三',
      phone: '13800138000',
      position: '收银员',
      department: '前厅',
      joinDate: new Date('2026-05-01T00:00:00.000Z'),
      baseSalary: 450000,
      avatar: null,
      idCard: null,
      gender: EmployeeGender.male,
      emergencyContact: null,
      emergencyPhone: null,
      contractEndDate: null,
      note: null,
      status: EmployeeStatus.active,
      resignDate: null,
      resignReason: null,
      createdAt,
      updatedAt,
    });
    // #3 修复：事务内查找可用空槽位
    prismaService.storeSubAccount.findFirst.mockResolvedValue(null);
    prismaService.storeSubAccount.findMany.mockResolvedValue([
      { slotIndex: 1 },
    ]);
    prismaService.storeSubAccount.upsert.mockResolvedValue(undefined);
    // buildEmployeeDetail 需要的 mock
    prismaService.storeSubAccount.findMany.mockResolvedValue([
      {
        id: 7,
        employeeId: 12,
        slotIndex: 1,
        role: 'cashier',
        status: 'active',
        canUseHandover: true,
        createdAt,
        updatedAt,
      },
    ]);
    prismaService.staff.findMany.mockResolvedValue([
      {
        id: 18,
        phone: '13800138000',
        email: 'account_cashier_01@purelyprofit.local',
        loginAccount: 'cashier_01',
        updatedAt,
        employeeProfile: { id: 12 },
        user: { password: 'hashed-password' },
      },
    ]);

    const result = await service.updateSubAccount(user, 12, {
      role: 'cashier',
      loginAccount: 'cashier_01',
      password: 'test123456',
    });

    // #3 修复：现在通过事务内 upsert 直接更新，而非调用 storeSubAccountService.updateSlot
    expect(prismaService.storeSubAccount.upsert).toHaveBeenCalled();
    expect(
      employeesAccessService.ensureCanManageEmployeeSubAccount,
    ).toHaveBeenCalledWith(user);
    expect(result.subAccount).toEqual({
      id: '7',
      role: 'cashier',
      roleLabel: '收银员',
      status: 'active',
      slotIndex: 1,
      loginAccount: '13800138000 / cashier_01',
      canHandover: true,
      hasPassword: true,
      createdAt: createdAt.getTime(),
      updatedAt: updatedAt.getTime(),
    });
  });

  it('updateSubAccount 会阻止子账号直接管理员工子账号', async () => {
    const managerUser: AuthenticatedUser = {
      ...user,
      currentMembership: {
        staffId: 10,
        storeId: 2,
        role: 'staff',
        permissions: ['staff:view', 'staff:update'],
        isActive: true,
        subjectType: 'sub_account',
        linkedEmployeeId: 12,
        subAccountId: 6,
        subAccountRole: 'manager',
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
      },
    };
    employeesAccessService.ensureCanManageEmployeeSubAccount.mockImplementation(
      () => {
        throw new ForbiddenException('子账号无权管理员工子账号');
      },
    );

    await expect(
      service.updateSubAccount(managerUser, 12, {
        role: 'cashier',
        loginAccount: 'cashier_01',
      }),
    ).rejects.toThrow('子账号无权管理员工子账号');

    expect(
      employeesAccessService.findManageableEmployeeOrThrow,
    ).not.toHaveBeenCalled();
    expect(storeSubAccountService.updateSlot).not.toHaveBeenCalled();
  });

  it('getPayrollReport 会仅聚合已结算工资并对齐前端字段', async () => {
    employeesAccessService.resolveViewStoreId.mockResolvedValue(2);
    prismaService.employeePayroll.findMany.mockResolvedValue([
      {
        id: 21,
        employeeId: 5,
        employeeName: '王五',
        month: new Date('2026-05-01T00:00:00.000Z'),
        baseSalary: 500000,
        leaveDeduction: 10000,
        otherDeduction: 5000,
        bonus: 20000,
        actualSalary: 505000,
        socialInsurance: 40000,
        housingFund: 0,
        totalLaborCost: 545000,
        confirmedAt: new Date('2026-05-15T10:00:00.000Z'),
      },
      {
        id: 22,
        employeeId: 9,
        employeeName: '李四',
        month: new Date('2026-04-01T00:00:00.000Z'),
        baseSalary: 450000,
        leaveDeduction: 0,
        otherDeduction: 0,
        bonus: 10000,
        actualSalary: 460000,
        socialInsurance: 0,
        housingFund: 30000,
        totalLaborCost: 490000,
        confirmedAt: new Date('2026-04-30T08:00:00.000Z'),
      },
    ]);

    await expect(
      service.getPayrollReport(user, {
        storeId: 2,
        year: 2026,
        month: 0,
        department: '前厅',
      }),
    ).resolves.toEqual({
      summary: {
        confirmedCount: 2,
        totalActualSalary: 9650,
        totalLaborCost: 10350,
        avgActualSalary: 4825,
      },
      rows: [
        {
          id: '21',
          employeeName: '王五',
          month: '2026-05',
          baseSalary: 5000,
          leaveDeduction: 100,
          otherDeduction: 50,
          bonus: 200,
          actualSalary: 5050,
          socialInsurance: 400,
          totalLaborCost: 5450,
          confirmedAt: new Date('2026-05-15T10:00:00.000Z').getTime(),
        },
        {
          id: '22',
          employeeName: '李四',
          month: '2026-04',
          baseSalary: 4500,
          leaveDeduction: 0,
          otherDeduction: 0,
          bonus: 100,
          actualSalary: 4600,
          housingFund: 300,
          totalLaborCost: 4900,
          confirmedAt: new Date('2026-04-30T08:00:00.000Z').getTime(),
        },
      ],
    });

    expect(employeesAccessService.resolveViewStoreId).toHaveBeenCalledWith(
      user,
      2,
      '无权查看该门店工资报表',
      'report:view',
    );
    expect(prismaService.employeePayroll.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 2,
        status: EmployeePayrollStatus.confirmed,
        month: {
          gte: new Date(2026, 0, 1, 0, 0, 0, 0),
          lt: new Date(2027, 0, 1, 0, 0, 0, 0),
        },
        employee: {
          department: { equals: '前厅', mode: 'insensitive' },
        },
      },
      orderBy: [{ month: 'desc' }, { employeeName: 'asc' }, { id: 'asc' }],
    });
  });
});
