import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmployeeGender,
  EmployeePayrollStatus,
  EmployeeStatus,
  Prisma,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesService } from './employees.service';

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
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    employeeShift: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
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
        { provide: PrismaService, useValue: prismaService },
        { provide: EmployeesAccessService, useValue: employeesAccessService },
        { provide: ConfigService, useValue: configService },
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

  it('create 会补齐部门职位、生成员工编号并规范化字段', async () => {
    const joinDate = new Date('2026-05-01T00:00:00.000Z').getTime();
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const updatedAt = new Date('2026-05-13T10:30:00.000Z');

    employeesAccessService.ensureCanManageEmployees.mockResolvedValue(
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
      idCard: null,
      gender: EmployeeGender.unset,
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

    const result = await service.create(user, {
      storeId: 2,
      name: ' 张三 ',
      phone: ' 13800138000 ',
      position: ' 店长 ',
      department: ' 前厅 ',
      joinDate,
      baseSalary: 4800,
      note: '   ',
    });

    expect(
      employeesAccessService.ensureCanManageEmployees,
    ).toHaveBeenCalledWith(user, 2, 'staff:create');
    expect(prismaService.employeeDepartment.create).toHaveBeenCalledWith({
      data: { storeId: 2, name: '前厅' },
    });
    expect(prismaService.employeePosition.create).toHaveBeenCalledWith({
      data: { storeId: 2, name: '店长' },
    });

    const employeeCreateArgs = prismaService.employee.create.mock.calls[0][0];
    expect(employeeCreateArgs.data.storeId).toBe(2);
    expect(employeeCreateArgs.data.departmentId).toBe(8);
    expect(employeeCreateArgs.data.positionId).toBe(9);
    expect(employeeCreateArgs.data.empNo).toBe('EMP010');
    expect(employeeCreateArgs.data.name).toBe('张三');
    expect(employeeCreateArgs.data.phone).toBe('13800138000');
    expect(employeeCreateArgs.data.position).toBe('店长');
    expect(employeeCreateArgs.data.department).toBe('前厅');
    expect(employeeCreateArgs.data.joinDate).toEqual(new Date(joinDate));
    expect(employeeCreateArgs.data.baseSalary).toBeInstanceOf(Prisma.Decimal);
    expect(employeeCreateArgs.data.baseSalary.toString()).toBe('4800');
    expect(employeeCreateArgs.data.gender).toBe(EmployeeGender.unset);
    expect(employeeCreateArgs.data.note).toBeNull();
    expect(employeeCreateArgs.data.status).toBe(EmployeeStatus.active);

    expect(result).toMatchObject({
      id: '10',
      empNo: 'EMP010',
      name: '张三',
      phone: '13800138000',
      position: '店长',
      department: '前厅',
      baseSalary: 4800,
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

  it('savePayroll 会计算工资汇总并重置确认状态', async () => {
    const createdAt = new Date('2026-05-13T08:00:00.000Z');
    const updatedAt = new Date('2026-05-13T09:00:00.000Z');

    employeesAccessService.findManageableEmployeeOrThrow.mockResolvedValue({
      id: 5,
      storeId: 2,
      name: '王五',
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

    const upsertArgs = prismaService.employeePayroll.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({
      employeeId_month: {
        employeeId: 5,
        month: '2026-04',
      },
    });
    expect(upsertArgs.create.employeeName).toBe('王五');
    expect(upsertArgs.create.actualSalary.toString()).toBe('5100');
    expect(upsertArgs.create.totalLaborCost.toString()).toBe('5500');
    expect(upsertArgs.create.otherDeductionNote).toBe('迟到罚款');
    expect(upsertArgs.create.housingFund).toBeUndefined();
    expect(upsertArgs.update.status).toBe(EmployeePayrollStatus.draft);
    expect(upsertArgs.update.confirmedAt).toBeNull();
    expect(upsertArgs.update.housingFund).toBeNull();

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
    expect(prismaService.employeePayroll.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: {
        status: EmployeePayrollStatus.confirmed,
        confirmedAt: expect.any(Date),
      },
    });
    expect(result.status).toBe(EmployeePayrollStatus.confirmed);
    expect(result.confirmedAt).toBe(confirmedAt.getTime());
  });

  it('confirmPayroll 在记录不存在时抛出异常', async () => {
    prismaService.employeePayroll.findUnique.mockResolvedValue(null);

    await expect(service.confirmPayroll(user, 999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prismaService.employeePayroll.update).not.toHaveBeenCalled();
  });
});
