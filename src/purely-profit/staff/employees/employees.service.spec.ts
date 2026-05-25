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
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesDictionaryService } from './employees-dictionary.service';
import { EmployeesLeaveService } from './employees-leave.service';
import { EmployeesPayrollService } from './employees-payroll.service';
import { EmployeesProfileReadService } from './employees-profile-read.service';
import { EmployeesProfileWriteService } from './employees-profile-write.service';
import { EmployeesService } from './employees.service';
import { EmployeesShiftService } from './employees-shift.service';

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
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employeePosition: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
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
      delete: jest.fn(),
    },
    employeeShift: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employeePayroll: {
      count: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const employeesAccessService = {
    resolveViewStoreId: jest.fn(),
    ensureCanManageEmployees: jest.fn(),
    findManageableEmployeeOrThrow: jest.fn(),
    resolveSingleStoreId: jest.fn(),
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

    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, number> = {
        'app.defaultPageSize': 10,
        'app.maxPageSize': 50,
      };
      return configMap[key];
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
        { provide: EmployeesAccessService, useValue: employeesAccessService },
        { provide: ConfigService, useValue: configService },
        { provide: CostsService, useValue: costsService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
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
        baseSalary: new Prisma.Decimal('5800'),
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
        status: EmployeeStatus.active,
        department: { equals: '前厅', mode: 'insensitive' },
        OR: [
          { name: { contains: '张', mode: 'insensitive' } },
          { empNo: { contains: '张', mode: 'insensitive' } },
          { phone: { contains: '张' } },
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
      where: { storeId: 2 },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 10,
    });
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
    prismaService.employee.create.mockResolvedValue({
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
      baseSalary: new Prisma.Decimal('4800'),
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
    });

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
        baseSalary: expect.any(Prisma.Decimal),
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
    expect(createdEmployeeSalary).toBeInstanceOf(Prisma.Decimal);
    expect((createdEmployeeSalary as Prisma.Decimal).toString()).toBe('4800');

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
      deductAmount: new Prisma.Decimal('50'),
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
      days: new Prisma.Decimal('2'),
      deductSalary: false,
      deductAmount: new Prisma.Decimal('0'),
      note: null,
      createdAt,
    });

    const result = await service.updateLeave(user, 31, {
      type: 'sick',
      startDate: new Date('2026-05-06T00:00:00.000Z').getTime(),
      endDate: new Date('2026-05-07T00:00:00.000Z').getTime(),
      days: 2,
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
        days: expect.any(Prisma.Decimal),
        deductSalary: false,
        deductAmount: expect.any(Prisma.Decimal),
        note: null,
      },
    });
    const leaveUpdateArgs = prismaService.employeeLeave.update.mock.calls.at(
      0,
    )?.[0] as {
      data: { days: Prisma.Decimal; deductAmount: Prisma.Decimal };
    };
    expect(leaveUpdateArgs.data.days.toString()).toBe('2');
    expect(leaveUpdateArgs.data.deductAmount.toString()).toBe('0');
    expect(result).toEqual({
      id: '31',
      employeeId: '5',
      employeeName: '王五',
      type: 'sick',
      startDate: new Date('2026-05-06T00:00:00.000Z').getTime(),
      endDate: new Date('2026-05-07T00:00:00.000Z').getTime(),
      days: 2,
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
    prismaService.employeeShift.update.mockResolvedValue({
      id: 41,
      storeId: 2,
      employeeId: 5,
      employeeName: '王五',
      date: new Date('2026-05-08T00:00:00.000Z'),
      shiftType: 'late',
      startTime: '17:30',
      endTime: '23:30',
      note: null,
      createdAt,
    });

    const result = await service.updateShift(user, 41, {
      date: new Date('2026-05-08T00:00:00.000Z').getTime(),
      shiftType: 'late',
      startTime: '17:30',
      endTime: '23:30',
      note: '   ',
    });

    expect(
      employeesAccessService.ensureCanManageEmployees,
    ).toHaveBeenCalledWith(user, 2, 'staff:update');
    expect(prismaService.employeeShift.update).toHaveBeenCalledWith({
      where: { id: 41 },
      data: {
        date: new Date('2026-05-08T00:00:00.000Z'),
        shiftType: 'late',
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
      shiftType: 'late',
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
        days: 2,
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
        days: 1,
        deductSalary: false,
        deductAmount: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaService.employeeLeave.create).not.toHaveBeenCalled();
  });

  it('createShift 在同一天已有排班时抛出异常', async () => {
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

    await expect(
      service.createShift(user, {
        employeeId: 5,
        date: new Date('2026-05-08T00:00:00.000Z').getTime(),
        shiftType: 'late',
        startTime: '13:00',
        endTime: '18:00',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaService.employeeShift.create).not.toHaveBeenCalled();
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

    await expect(
      service.createShift(user, {
        employeeId: 5,
        date: new Date('2026-05-08T00:00:00.000Z').getTime(),
        shiftType: 'late',
        startTime: '13:30',
        endTime: '18:00',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaService.employeeShift.create).not.toHaveBeenCalled();
  });

  it('updateShift 在上班时间不早于下班时间时抛出异常', async () => {
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

    await expect(
      service.updateShift(user, 41, {
        startTime: '18:00',
        endTime: '18:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaService.employeeShift.update).not.toHaveBeenCalled();
  });

  it('listPayrolls 在按全年筛选时会返回整年工资记录', async () => {
    const createdAt = new Date('2026-05-13T08:00:00.000Z');
    const updatedAt = new Date('2026-05-13T09:00:00.000Z');

    employeesAccessService.resolveViewStoreId.mockResolvedValue(2);
    prismaService.employeePayroll.findMany.mockResolvedValue([
      {
        id: 21,
        storeId: 2,
        employeeId: 5,
        employeeName: '王五',
        month: '2026-05',
        baseSalary: new Prisma.Decimal('5000'),
        leaveDeduction: new Prisma.Decimal('120'),
        otherDeduction: new Prisma.Decimal('80'),
        otherDeductionNote: '迟到罚款',
        bonus: new Prisma.Decimal('300'),
        actualSalary: new Prisma.Decimal('5100'),
        socialInsurance: new Prisma.Decimal('400'),
        housingFund: null,
        totalLaborCost: new Prisma.Decimal('5500'),
        status: EmployeePayrollStatus.draft,
        confirmedAt: null,
        note: '含季度奖励',
        createdAt,
        updatedAt,
      },
    ]);

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
          gte: '2026-01',
          lte: '2026-12',
        },
        employee: {
          department: { equals: '前厅', mode: 'insensitive' },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(result).toEqual([
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
    ]);
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
    prismaService.employeePayroll.upsert.mockResolvedValue({
      id: 21,
      storeId: 2,
      employeeId: 5,
      employeeName: '王五',
      month: '2026-04',
      baseSalary: new Prisma.Decimal('5000'),
      leaveDeduction: new Prisma.Decimal('120'),
      otherDeduction: new Prisma.Decimal('80'),
      otherDeductionNote: '迟到罚款',
      bonus: new Prisma.Decimal('300'),
      actualSalary: new Prisma.Decimal('5100'),
      socialInsurance: new Prisma.Decimal('400'),
      housingFund: null,
      totalLaborCost: new Prisma.Decimal('5500'),
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

    expect(prismaService.employeePayroll.upsert).toHaveBeenCalledWith({
      where: {
        employeeId_month: {
          employeeId: 5,
          month: '2026-04',
        },
      },
      create: expect.objectContaining({
        employeeName: '王五',
        otherDeductionNote: '迟到罚款',
        housingFund: undefined,
      }),
      update: expect.objectContaining({
        status: EmployeePayrollStatus.draft,
        confirmedAt: null,
        housingFund: null,
      }),
    });
    const payrollUpsertArgs =
      prismaService.employeePayroll.upsert.mock.calls.at(0)?.[0] as {
        create: {
          actualSalary: Prisma.Decimal;
          totalLaborCost: Prisma.Decimal;
        };
      };
    expect(payrollUpsertArgs.create.actualSalary.toString()).toBe('5100');
    expect(payrollUpsertArgs.create.totalLaborCost.toString()).toBe('5500');
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
      month: '2026-04',
      baseSalary: new Prisma.Decimal('5000'),
      leaveDeduction: new Prisma.Decimal('120'),
      otherDeduction: new Prisma.Decimal('80'),
      otherDeductionNote: null,
      bonus: new Prisma.Decimal('300'),
      actualSalary: new Prisma.Decimal('5100'),
      socialInsurance: null,
      housingFund: null,
      totalLaborCost: new Prisma.Decimal('5100'),
      status: EmployeePayrollStatus.confirmed,
      confirmedAt,
      note: null,
      createdAt,
      updatedAt,
    });

    const result = await service.confirmPayroll(user, 21);

    expect(
      employeesAccessService.ensureCanManageEmployees,
    ).toHaveBeenCalledWith(user, 2, 'staff:update');
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

  it('getShiftReport 会按前端报表结构聚合排班数据', async () => {
    employeesAccessService.resolveViewStoreId.mockResolvedValue(2);
    prismaService.employeeShift.findMany.mockResolvedValue([
      {
        id: 11,
        employeeId: 5,
        employeeName: '王五',
        date: new Date('2026-05-01T00:00:00.000Z'),
        shiftType: 'morning',
        startTime: '08:00',
        endTime: '14:00',
      },
      {
        id: 12,
        employeeId: 5,
        employeeName: '王五',
        date: new Date('2026-05-02T00:00:00.000Z'),
        shiftType: 'custom',
        startTime: '10:00',
        endTime: '16:00',
      },
      {
        id: 13,
        employeeId: 9,
        employeeName: '李四',
        date: new Date('2026-05-03T00:00:00.000Z'),
        shiftType: 'late',
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
        morningCount: 1,
        nineToSixCount: 0,
        middleCount: 0,
        lateCount: 1,
        fullCount: 0,
        customCount: 1,
      },
      rows: [
        {
          id: '11',
          dateLabel: '05/01 周五',
          employeeName: '王五',
          shiftType: 'morning',
          shiftLabel: '早班',
          startTime: '08:00',
          endTime: '14:00',
        },
        {
          id: '12',
          dateLabel: '05/02 周六',
          employeeName: '王五',
          shiftType: 'custom',
          shiftLabel: '自定义',
          startTime: '10:00',
          endTime: '16:00',
        },
        {
          id: '13',
          dateLabel: '05/03 周日',
          employeeName: '李四',
          shiftType: 'late',
          shiftLabel: '晚班',
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
          gte: new Date(2026, 4, 1, 0, 0, 0, 0),
          lt: new Date(2026, 5, 1, 0, 0, 0, 0),
        },
        employee: {
          department: { equals: '前厅', mode: 'insensitive' },
        },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
  });

  it('getPayrollReport 会仅聚合已结算工资并对齐前端字段', async () => {
    employeesAccessService.resolveViewStoreId.mockResolvedValue(2);
    prismaService.employeePayroll.findMany.mockResolvedValue([
      {
        id: 21,
        employeeId: 5,
        employeeName: '王五',
        month: '2026-05',
        baseSalary: new Prisma.Decimal('5000'),
        leaveDeduction: new Prisma.Decimal('100'),
        otherDeduction: new Prisma.Decimal('50'),
        bonus: new Prisma.Decimal('200'),
        actualSalary: new Prisma.Decimal('5050'),
        socialInsurance: new Prisma.Decimal('400'),
        housingFund: null,
        totalLaborCost: new Prisma.Decimal('5450'),
        confirmedAt: new Date('2026-05-15T10:00:00.000Z'),
      },
      {
        id: 22,
        employeeId: 9,
        employeeName: '李四',
        month: '2026-04',
        baseSalary: new Prisma.Decimal('4500'),
        leaveDeduction: new Prisma.Decimal('0'),
        otherDeduction: new Prisma.Decimal('0'),
        bonus: new Prisma.Decimal('100'),
        actualSalary: new Prisma.Decimal('4600'),
        socialInsurance: null,
        housingFund: new Prisma.Decimal('300'),
        totalLaborCost: new Prisma.Decimal('4900'),
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
          gte: '2026-01',
          lte: '2026-12',
        },
        employee: {
          department: { equals: '前厅', mode: 'insensitive' },
        },
      },
      orderBy: [{ month: 'desc' }, { employeeName: 'asc' }, { id: 'asc' }],
    });
  });
});
