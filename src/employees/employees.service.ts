import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmployeeGender,
  EmployeePayrollStatus,
  EmployeeStatus,
  Prisma,
} from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEmployeeDictionaryDto,
  EmployeeDepartmentResponseDto,
  EmployeePositionResponseDto,
  EmployeeStoreQueryDto,
  UpdateEmployeeDictionaryDto,
} from './dto/employee-dictionary.dto';
import {
  CreateEmployeeLeaveDto,
  EmployeeLeaveResponseDto,
} from './dto/employee-leave.dto';
import {
  EmployeePayrollResponseDto,
  ListEmployeePayrollsQueryDto,
  SaveEmployeePayrollDto,
} from './dto/employee-payroll.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import {
  EmployeeResponseDto,
  EmployeesOverviewQueryDto,
  EmployeesOverviewResponseDto,
  ListEmployeesQueryDto,
  PaginatedEmployeesResponseDto,
} from './dto/employee-response.dto';
import {
  CreateEmployeeShiftDto,
  EmployeeShiftResponseDto,
  ListEmployeeShiftsQueryDto,
} from './dto/employee-shift.dto';
import { ResignEmployeeDto } from './dto/resign-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesAccessService } from './employees-access.service';
import {
  toEmployeeDepartmentResponse,
  toEmployeeLeaveResponse,
  toEmployeePayrollResponse,
  toEmployeePositionResponse,
  toEmployeeResponse,
  toEmployeeShiftResponse,
} from './employees.mapper';
import {
  buildDateRange,
  buildPaginationMeta,
  getCurrentMonthString,
  getStartOfCurrentMonth,
  normalizeMonthValue,
  resolvePagination,
  toDecimalNumber,
  toNullableText,
} from './employees.utils';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly configService: ConfigService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListEmployeesQueryDto,
  ): Promise<PaginatedEmployeesResponseDto> {
    const storeId = await this.employeesAccessService.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店员工列表',
    );
    const { page, skip, take } = this.resolvePagination(
      query.page,
      query.pageSize,
    );
    const where: Prisma.EmployeeWhereInput = {
      storeId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.department
        ? { department: { equals: query.department, mode: 'insensitive' } }
        : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { empNo: { contains: query.keyword, mode: 'insensitive' } },
              { phone: { contains: query.keyword } },
              { position: { contains: query.keyword, mode: 'insensitive' } },
              { department: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      items: items.map(toEmployeeResponse),
      meta: buildPaginationMeta(total, page, take),
    };
  }

  async getOverview(
    user: AuthenticatedUser,
    query: EmployeesOverviewQueryDto,
  ): Promise<EmployeesOverviewResponseDto> {
    const storeId = await this.employeesAccessService.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店员工概览',
    );
    const monthStart = getStartOfCurrentMonth();
    const currentMonth = getCurrentMonthString();

    const [
      activeCount,
      resignedCount,
      leaveRows,
      pendingPayrollCount,
      resignedThisMonth,
    ] = await Promise.all([
      this.prisma.employee.count({
        where: { storeId, status: EmployeeStatus.active },
      }),
      this.prisma.employee.count({
        where: { storeId, status: EmployeeStatus.resigned },
      }),
      this.prisma.employeeLeave.findMany({
        where: {
          storeId,
          startDate: { gte: monthStart },
        },
        select: { days: true },
      }),
      this.prisma.employeePayroll.count({
        where: {
          storeId,
          month: currentMonth,
          status: EmployeePayrollStatus.draft,
        },
      }),
      this.prisma.employee.count({
        where: {
          storeId,
          status: EmployeeStatus.resigned,
          resignDate: { gte: monthStart },
        },
      }),
    ]);

    return {
      activeCount,
      resignedCount,
      leaveDaysThisMonth: leaveRows.reduce(
        (sum, item) => sum + toDecimalNumber(item.days),
        0,
      ),
      pendingPayrollCount,
      resignedThisMonth,
    };
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      dto.storeId,
      'staff:create',
    );

    const [department, position] = await Promise.all([
      this.ensureDepartment(dto.storeId, dto.department),
      this.ensurePosition(dto.storeId, dto.position),
    ]);
    const empNo = await this.generateEmpNo(dto.storeId);

    const employee = await this.prisma.employee.create({
      data: {
        storeId: dto.storeId,
        departmentId: department.id,
        positionId: position.id,
        empNo,
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        position: position.name,
        department: department.name,
        joinDate: new Date(dto.joinDate),
        baseSalary: this.toDecimal(dto.baseSalary),
        avatar: toNullableText(dto.avatar),
        idCard: toNullableText(dto.idCard),
        gender: dto.gender ?? EmployeeGender.unset,
        emergencyContact: toNullableText(dto.emergencyContact),
        emergencyPhone: toNullableText(dto.emergencyPhone),
        contractEndDate: dto.contractEndDate
          ? new Date(dto.contractEndDate)
          : undefined,
        note: toNullableText(dto.note),
        status: EmployeeStatus.active,
      },
    });

    return toEmployeeResponse(employee);
  }

  async getDetail(
    user: AuthenticatedUser,
    employeeId: number,
  ): Promise<EmployeeResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:view',
      );
    return toEmployeeResponse(employee);
  }

  async update(
    user: AuthenticatedUser,
    employeeId: number,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    const department = dto.department
      ? await this.ensureDepartment(employee.storeId, dto.department)
      : undefined;
    const position = dto.position
      ? await this.ensurePosition(employee.storeId, dto.position)
      : undefined;

    const updated = await this.prisma.employee.update({
      where: { id: employee.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
        ...(department
          ? {
              departmentId: department.id,
              department: department.name,
            }
          : {}),
        ...(position
          ? {
              positionId: position.id,
              position: position.name,
            }
          : {}),
        ...(dto.joinDate !== undefined
          ? { joinDate: new Date(dto.joinDate) }
          : {}),
        ...(dto.baseSalary !== undefined
          ? { baseSalary: this.toDecimal(dto.baseSalary) }
          : {}),
        ...(dto.avatar !== undefined
          ? { avatar: toNullableText(dto.avatar) }
          : {}),
        ...(dto.idCard !== undefined
          ? { idCard: toNullableText(dto.idCard) }
          : {}),
        ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
        ...(dto.emergencyContact !== undefined
          ? { emergencyContact: toNullableText(dto.emergencyContact) }
          : {}),
        ...(dto.emergencyPhone !== undefined
          ? { emergencyPhone: toNullableText(dto.emergencyPhone) }
          : {}),
        ...(dto.contractEndDate !== undefined
          ? {
              contractEndDate: dto.contractEndDate
                ? new Date(dto.contractEndDate)
                : null,
            }
          : {}),
        ...(dto.note !== undefined ? { note: toNullableText(dto.note) } : {}),
      },
    });

    return toEmployeeResponse(updated);
  }

  async resign(
    user: AuthenticatedUser,
    employeeId: number,
    dto: ResignEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    const resigned = await this.prisma.employee.update({
      where: { id: employee.id },
      data: {
        status: EmployeeStatus.resigned,
        resignDate: dto.resignDate ? new Date(dto.resignDate) : new Date(),
        resignReason: toNullableText(dto.resignReason),
      },
    });

    return toEmployeeResponse(resigned);
  }

  async remove(user: AuthenticatedUser, employeeId: number): Promise<void> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );

    await this.prisma.employee.delete({
      where: { id: employee.id },
    });
  }

  async listDepartments(
    user: AuthenticatedUser,
    query: EmployeeStoreQueryDto,
  ): Promise<EmployeeDepartmentResponseDto[]> {
    const storeId = await this.employeesAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'staff:view',
    );
    const rows = await this.prisma.employeeDepartment.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEmployeeDepartmentResponse);
  }

  async createDepartment(
    user: AuthenticatedUser,
    dto: CreateEmployeeDictionaryDto,
  ): Promise<EmployeeDepartmentResponseDto> {
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      dto.storeId,
      'staff:create',
    );
    const department = await this.prisma.employeeDepartment.create({
      data: {
        storeId: dto.storeId,
        name: dto.name.trim(),
      },
    });
    return toEmployeeDepartmentResponse(department);
  }

  async updateDepartment(
    user: AuthenticatedUser,
    departmentId: number,
    dto: UpdateEmployeeDictionaryDto,
  ): Promise<EmployeeDepartmentResponseDto> {
    const existing = await this.prisma.employeeDepartment.findUnique({
      where: { id: departmentId },
    });
    if (!existing) {
      throw new NotFoundException('部门不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      existing.storeId,
      'staff:update',
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.employeeDepartment.update({
        where: { id: existing.id },
        data: { name: dto.name.trim() },
      });
      await tx.employee.updateMany({
        where: { departmentId: existing.id },
        data: { department: next.name },
      });
      return next;
    });
    return toEmployeeDepartmentResponse(updated);
  }

  async removeDepartment(
    user: AuthenticatedUser,
    departmentId: number,
  ): Promise<void> {
    const existing = await this.prisma.employeeDepartment.findUnique({
      where: { id: departmentId },
      include: { _count: { select: { employees: true } } },
    });
    if (!existing) {
      throw new NotFoundException('部门不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      existing.storeId,
      'staff:update',
    );
    if (existing._count.employees > 0) {
      throw new ConflictException('当前部门下仍有关联员工，无法删除');
    }
    await this.prisma.employeeDepartment.delete({ where: { id: existing.id } });
  }

  async listPositions(
    user: AuthenticatedUser,
    query: EmployeeStoreQueryDto,
  ): Promise<EmployeePositionResponseDto[]> {
    const storeId = await this.employeesAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      'staff:view',
    );
    const rows = await this.prisma.employeePosition.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEmployeePositionResponse);
  }

  async createPosition(
    user: AuthenticatedUser,
    dto: CreateEmployeeDictionaryDto,
  ): Promise<EmployeePositionResponseDto> {
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      dto.storeId,
      'staff:create',
    );
    const position = await this.prisma.employeePosition.create({
      data: {
        storeId: dto.storeId,
        name: dto.name.trim(),
      },
    });
    return toEmployeePositionResponse(position);
  }

  async updatePosition(
    user: AuthenticatedUser,
    positionId: number,
    dto: UpdateEmployeeDictionaryDto,
  ): Promise<EmployeePositionResponseDto> {
    const existing = await this.prisma.employeePosition.findUnique({
      where: { id: positionId },
    });
    if (!existing) {
      throw new NotFoundException('职位不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      existing.storeId,
      'staff:update',
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.employeePosition.update({
        where: { id: existing.id },
        data: { name: dto.name.trim() },
      });
      await tx.employee.updateMany({
        where: { positionId: existing.id },
        data: { position: next.name },
      });
      return next;
    });
    return toEmployeePositionResponse(updated);
  }

  async removePosition(
    user: AuthenticatedUser,
    positionId: number,
  ): Promise<void> {
    const existing = await this.prisma.employeePosition.findUnique({
      where: { id: positionId },
      include: { _count: { select: { employees: true } } },
    });
    if (!existing) {
      throw new NotFoundException('职位不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      existing.storeId,
      'staff:update',
    );
    if (existing._count.employees > 0) {
      throw new ConflictException('当前职位下仍有关联员工，无法删除');
    }
    await this.prisma.employeePosition.delete({ where: { id: existing.id } });
  }

  async listLeaves(
    user: AuthenticatedUser,
    employeeId: number,
  ): Promise<EmployeeLeaveResponseDto[]> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:view',
      );
    const rows = await this.prisma.employeeLeave.findMany({
      where: { employeeId: employee.id },
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toEmployeeLeaveResponse);
  }

  async createLeave(
    user: AuthenticatedUser,
    employeeId: number,
    dto: CreateEmployeeLeaveDto,
  ): Promise<EmployeeLeaveResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        employeeId,
        'staff:update',
      );
    const leave = await this.prisma.employeeLeave.create({
      data: {
        storeId: employee.storeId,
        employeeId: employee.id,
        employeeName: employee.name,
        type: dto.type,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        days: this.toDecimal(dto.days),
        deductSalary: dto.deductSalary,
        deductAmount: this.toDecimal(dto.deductAmount),
        note: toNullableText(dto.note),
      },
    });
    return toEmployeeLeaveResponse(leave);
  }

  async removeLeave(user: AuthenticatedUser, leaveId: number): Promise<void> {
    const leave = await this.prisma.employeeLeave.findUnique({
      where: { id: leaveId },
    });
    if (!leave) {
      throw new NotFoundException('请假记录不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      leave.storeId,
      'staff:update',
    );
    await this.prisma.employeeLeave.delete({ where: { id: leave.id } });
  }

  async listShifts(
    user: AuthenticatedUser,
    query: ListEmployeeShiftsQueryDto,
  ): Promise<EmployeeShiftResponseDto[]> {
    const storeId = await this.employeesAccessService.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店排班',
    );
    const dateRange = buildDateRange(query.year, query.month);
    const rows = await this.prisma.employeeShift.findMany({
      where: {
        storeId,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(dateRange ? { date: dateRange } : {}),
        ...(query.department
          ? {
              employee: {
                department: { equals: query.department, mode: 'insensitive' },
              },
            }
          : {}),
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toEmployeeShiftResponse);
  }

  async createShift(
    user: AuthenticatedUser,
    dto: CreateEmployeeShiftDto,
  ): Promise<EmployeeShiftResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        dto.employeeId,
        'staff:update',
      );
    const shift = await this.prisma.employeeShift.create({
      data: {
        storeId: employee.storeId,
        employeeId: employee.id,
        employeeName: employee.name,
        date: new Date(dto.date),
        shiftType: dto.shiftType,
        startTime: dto.startTime,
        endTime: dto.endTime,
        note: toNullableText(dto.note),
      },
    });
    return toEmployeeShiftResponse(shift);
  }

  async removeShift(user: AuthenticatedUser, shiftId: number): Promise<void> {
    const shift = await this.prisma.employeeShift.findUnique({
      where: { id: shiftId },
    });
    if (!shift) {
      throw new NotFoundException('排班记录不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      shift.storeId,
      'staff:update',
    );
    await this.prisma.employeeShift.delete({ where: { id: shift.id } });
  }

  async listPayrolls(
    user: AuthenticatedUser,
    query: ListEmployeePayrollsQueryDto,
  ): Promise<EmployeePayrollResponseDto[]> {
    const storeId = await this.employeesAccessService.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店工资数据',
    );
    const targetMonth = this.resolvePayrollMonthFilter(query.year, query.month);
    const rows = await this.prisma.employeePayroll.findMany({
      where: {
        storeId,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(targetMonth ? { month: targetMonth } : {}),
        ...(query.department
          ? {
              employee: {
                department: { equals: query.department, mode: 'insensitive' },
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toEmployeePayrollResponse);
  }

  async savePayroll(
    user: AuthenticatedUser,
    dto: SaveEmployeePayrollDto,
  ): Promise<EmployeePayrollResponseDto> {
    const employee =
      await this.employeesAccessService.findManageableEmployeeOrThrow(
        user,
        dto.employeeId,
        'staff:update',
      );
    const month = normalizeMonthValue(dto.month);
    const actualSalary =
      dto.baseSalary - dto.leaveDeduction - dto.otherDeduction + dto.bonus;
    const totalLaborCost =
      actualSalary + (dto.socialInsurance ?? 0) + (dto.housingFund ?? 0);

    const payroll = await this.prisma.employeePayroll.upsert({
      where: {
        employeeId_month: {
          employeeId: employee.id,
          month,
        },
      },
      create: {
        storeId: employee.storeId,
        employeeId: employee.id,
        employeeName: employee.name,
        month,
        baseSalary: this.toDecimal(dto.baseSalary),
        leaveDeduction: this.toDecimal(dto.leaveDeduction),
        otherDeduction: this.toDecimal(dto.otherDeduction),
        otherDeductionNote: toNullableText(dto.otherDeductionNote),
        bonus: this.toDecimal(dto.bonus),
        actualSalary: this.toDecimal(actualSalary),
        socialInsurance:
          dto.socialInsurance !== undefined
            ? this.toDecimal(dto.socialInsurance)
            : undefined,
        housingFund:
          dto.housingFund !== undefined
            ? this.toDecimal(dto.housingFund)
            : undefined,
        totalLaborCost: this.toDecimal(totalLaborCost),
        status: EmployeePayrollStatus.draft,
        note: toNullableText(dto.note),
      },
      update: {
        employeeName: employee.name,
        baseSalary: this.toDecimal(dto.baseSalary),
        leaveDeduction: this.toDecimal(dto.leaveDeduction),
        otherDeduction: this.toDecimal(dto.otherDeduction),
        otherDeductionNote: toNullableText(dto.otherDeductionNote),
        bonus: this.toDecimal(dto.bonus),
        actualSalary: this.toDecimal(actualSalary),
        socialInsurance:
          dto.socialInsurance !== undefined
            ? this.toDecimal(dto.socialInsurance)
            : null,
        housingFund:
          dto.housingFund !== undefined
            ? this.toDecimal(dto.housingFund)
            : null,
        totalLaborCost: this.toDecimal(totalLaborCost),
        status: EmployeePayrollStatus.draft,
        confirmedAt: null,
        note: toNullableText(dto.note),
      },
    });

    return toEmployeePayrollResponse(payroll);
  }

  async confirmPayroll(
    user: AuthenticatedUser,
    payrollId: number,
  ): Promise<EmployeePayrollResponseDto> {
    const payroll = await this.prisma.employeePayroll.findUnique({
      where: { id: payrollId },
    });
    if (!payroll) {
      throw new NotFoundException('工资记录不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      payroll.storeId,
      'staff:update',
    );
    const confirmed = await this.prisma.employeePayroll.update({
      where: { id: payroll.id },
      data: {
        status: EmployeePayrollStatus.confirmed,
        confirmedAt: new Date(),
      },
    });
    return toEmployeePayrollResponse(confirmed);
  }

  async removePayroll(
    user: AuthenticatedUser,
    payrollId: number,
  ): Promise<void> {
    const payroll = await this.prisma.employeePayroll.findUnique({
      where: { id: payrollId },
    });
    if (!payroll) {
      throw new NotFoundException('工资记录不存在');
    }
    await this.employeesAccessService.ensureCanManageEmployees(
      user,
      payroll.storeId,
      'staff:update',
    );
    await this.prisma.employeePayroll.delete({ where: { id: payroll.id } });
  }

  private async ensureDepartment(storeId: number, name: string) {
    const normalizedName = name.trim();
    const existing = await this.prisma.employeeDepartment.findFirst({
      where: {
        storeId,
        name: { equals: normalizedName, mode: 'insensitive' },
      },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.employeeDepartment.create({
      data: { storeId, name: normalizedName },
    });
  }

  private async ensurePosition(storeId: number, name: string) {
    const normalizedName = name.trim();
    const existing = await this.prisma.employeePosition.findFirst({
      where: {
        storeId,
        name: { equals: normalizedName, mode: 'insensitive' },
      },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.employeePosition.create({
      data: { storeId, name: normalizedName },
    });
  }

  private async generateEmpNo(storeId: number): Promise<string> {
    const latestEmployee = await this.prisma.employee.findFirst({
      where: { storeId },
      orderBy: { id: 'desc' },
      select: { empNo: true },
    });
    const currentNumber = latestEmployee?.empNo.match(/^EMP(\d+)$/)?.[1];
    const nextValue = (currentNumber ? Number(currentNumber) : 0) + 1;
    return `EMP${String(nextValue).padStart(3, '0')}`;
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }

  private resolvePayrollMonthFilter(
    year?: number,
    month?: number,
  ): string | undefined {
    if (!year || !month || month === 0) {
      return undefined;
    }

    return `${year}-${String(month).padStart(2, '0')}`;
  }

  private toDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value);
  }
}
