import {
  BadRequestException,
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
import { CostsService } from '../costs/costs.service';
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
  UpdateEmployeeLeaveDto,
} from './dto/employee-leave.dto';
import {
  EmployeePayrollReportResponseDto,
  EmployeePayrollResponseDto,
  ListEmployeePayrollsQueryDto,
  SaveEmployeePayrollDto,
  UpdateEmployeePayrollDto,
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
  EmployeeShiftReportResponseDto,
  EmployeeShiftResponseDto,
  ListEmployeeShiftsQueryDto,
  UpdateEmployeeShiftDto,
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

const SHIFT_REPORT_LABELS: Record<string, string> = {
  morning: '早班',
  nine_to_six: '行政班',
  middle: '中班',
  late: '晚班',
  full: '全天',
  custom: '自定义',
};

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
    private readonly configService: ConfigService,
    private readonly costsService: CostsService,
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

    const employeeOrderBy: Prisma.EmployeeOrderByWithRelationInput[] = query.status
      ? [{ createdAt: 'desc' }, { id: 'desc' }]
      : [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }];

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: employeeOrderBy,
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
    const storeId = await this.resolveManageableStoreId(
      user,
      dto.storeId,
      'staff:create',
    );

    const [department, position] = await Promise.all([
      this.ensureDepartment(storeId, dto.department),
      this.ensurePosition(storeId, dto.position),
    ]);
    const empNo = await this.generateEmpNo(storeId);

    const employee = await this.prisma.employee.create({
      data: {
        storeId,
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
    await this.ensureDefaultDepartment(storeId);
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
    const storeId = await this.resolveManageableStoreId(
      user,
      dto.storeId,
      'staff:create',
    );
    const name = dto.name.trim();
    await this.ensureDictionaryNameAvailable('department', storeId, name);
    const department = await this.prisma.employeeDepartment.create({
      data: {
        storeId,
        name,
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

    const name = dto.name.trim();
    await this.ensureDictionaryNameAvailable(
      'department',
      existing.storeId,
      name,
      existing.id,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.employeeDepartment.update({
        where: { id: existing.id },
        data: { name },
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
    const storeId = await this.resolveManageableStoreId(
      user,
      dto.storeId,
      'staff:create',
    );
    const name = dto.name.trim();
    await this.ensureDictionaryNameAvailable('position', storeId, name);
    const position = await this.prisma.employeePosition.create({
      data: {
        storeId,
        name,
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

    const name = dto.name.trim();
    await this.ensureDictionaryNameAvailable(
      'position',
      existing.storeId,
      name,
      existing.id,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.employeePosition.update({
        where: { id: existing.id },
        data: { name },
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
    this.assertLeaveBusinessRules({
      startDate: dto.startDate,
      endDate: dto.endDate,
      days: dto.days,
      deductSalary: dto.deductSalary,
      deductAmount: dto.deductAmount,
    });
    await this.ensureLeaveDateRangeAvailable(
      employee.id,
      dto.startDate,
      dto.endDate,
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

  async updateLeave(
    user: AuthenticatedUser,
    leaveId: number,
    dto: UpdateEmployeeLeaveDto,
  ): Promise<EmployeeLeaveResponseDto> {
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

    const nextLeaveStartDate = dto.startDate ?? leave.startDate.getTime();
    const nextLeaveEndDate = dto.endDate ?? leave.endDate.getTime();
    this.assertLeaveBusinessRules({
      startDate: nextLeaveStartDate,
      endDate: nextLeaveEndDate,
      days: dto.days ?? toDecimalNumber(leave.days),
      deductSalary: dto.deductSalary ?? leave.deductSalary,
      deductAmount: dto.deductAmount ?? toDecimalNumber(leave.deductAmount),
    });
    await this.ensureLeaveDateRangeAvailable(
      leave.employeeId,
      nextLeaveStartDate,
      nextLeaveEndDate,
      leave.id,
    );

    const updated = await this.prisma.employeeLeave.update({
      where: { id: leave.id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.startDate !== undefined
          ? { startDate: new Date(dto.startDate) }
          : {}),
        ...(dto.endDate !== undefined
          ? { endDate: new Date(dto.endDate) }
          : {}),
        ...(dto.days !== undefined ? { days: this.toDecimal(dto.days) } : {}),
        ...(dto.deductSalary !== undefined
          ? { deductSalary: dto.deductSalary }
          : {}),
        ...(dto.deductAmount !== undefined
          ? { deductAmount: this.toDecimal(dto.deductAmount) }
          : {}),
        ...(dto.note !== undefined ? { note: toNullableText(dto.note) } : {}),
      },
    });
    return toEmployeeLeaveResponse(updated);
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

  async getShiftReport(
    user: AuthenticatedUser,
    query: ListEmployeeShiftsQueryDto,
  ): Promise<EmployeeShiftReportResponseDto> {
    const storeId = await this.employeesAccessService.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店排班报表',
      'report:view',
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
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });

    let morningCount = 0;
    let nineToSixCount = 0;
    let middleCount = 0;
    let lateCount = 0;
    let fullCount = 0;
    let customCount = 0;
    const employeeIds = new Set<number>();

    for (const row of rows) {
      employeeIds.add(row.employeeId);
      if (row.shiftType === 'morning') {
        morningCount += 1;
      } else if (row.shiftType === 'nine_to_six') {
        nineToSixCount += 1;
      } else if (row.shiftType === 'middle') {
        middleCount += 1;
      } else if (row.shiftType === 'late') {
        lateCount += 1;
      } else if (row.shiftType === 'full') {
        fullCount += 1;
      } else {
        customCount += 1;
      }
    }

    return {
      summary: {
        totalShifts: rows.length,
        employeeCount: employeeIds.size,
        morningCount,
        nineToSixCount,
        middleCount,
        lateCount,
        fullCount,
        customCount,
      },
      rows: rows.map((row) => ({
        id: String(row.id),
        dateLabel: this.formatShiftReportDate(row.date),
        employeeName: row.employeeName,
        shiftType: row.shiftType,
        shiftLabel: SHIFT_REPORT_LABELS[row.shiftType] ?? row.shiftType,
        startTime: row.startTime,
        endTime: row.endTime,
      })),
    };
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
    this.assertShiftBusinessRules(dto.startTime, dto.endTime);
    await this.ensureShiftScheduleAvailable(
      employee.id,
      dto.date,
      dto.startTime,
      dto.endTime,
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

  async updateShift(
    user: AuthenticatedUser,
    shiftId: number,
    dto: UpdateEmployeeShiftDto,
  ): Promise<EmployeeShiftResponseDto> {
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

    const nextShiftDate = dto.date ?? shift.date.getTime();
    const nextShiftStartTime = dto.startTime ?? shift.startTime;
    const nextShiftEndTime = dto.endTime ?? shift.endTime;
    this.assertShiftBusinessRules(nextShiftStartTime, nextShiftEndTime);
    await this.ensureShiftScheduleAvailable(
      shift.employeeId,
      nextShiftDate,
      nextShiftStartTime,
      nextShiftEndTime,
      shift.id,
    );

    const updated = await this.prisma.employeeShift.update({
      where: { id: shift.id },
      data: {
        ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
        ...(dto.shiftType !== undefined ? { shiftType: dto.shiftType } : {}),
        ...(dto.startTime !== undefined ? { startTime: dto.startTime } : {}),
        ...(dto.endTime !== undefined ? { endTime: dto.endTime } : {}),
        ...(dto.note !== undefined ? { note: toNullableText(dto.note) } : {}),
      },
    });
    return toEmployeeShiftResponse(updated);
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

  async getPayrollReport(
    user: AuthenticatedUser,
    query: ListEmployeePayrollsQueryDto,
  ): Promise<EmployeePayrollReportResponseDto> {
    const storeId = await this.employeesAccessService.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店工资报表',
      'report:view',
    );
    const dateRange = buildDateRange(query.year, query.month);
    const rows = await this.prisma.employeePayroll.findMany({
      where: {
        storeId,
        status: EmployeePayrollStatus.confirmed,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(dateRange
          ? {
              month: {
                gte: this.formatPayrollMonth(dateRange.gte),
                lte: this.formatPayrollMonth(
                  new Date(dateRange.lt.getTime() - 1),
                ),
              },
            }
          : {}),
        ...(query.department
          ? {
              employee: {
                department: { equals: query.department, mode: 'insensitive' },
              },
            }
          : {}),
      },
      orderBy: [{ month: 'desc' }, { employeeName: 'asc' }, { id: 'asc' }],
    });

    const confirmedCount = rows.length;
    const totalActualSalary = rows.reduce(
      (sum, row) => sum + toDecimalNumber(row.actualSalary),
      0,
    );
    const totalLaborCost = rows.reduce(
      (sum, row) => sum + toDecimalNumber(row.totalLaborCost),
      0,
    );

    return {
      summary: {
        confirmedCount,
        totalActualSalary,
        totalLaborCost,
        avgActualSalary:
          confirmedCount === 0 ? 0 : totalActualSalary / confirmedCount,
      },
      rows: rows.map((row) => ({
        id: String(row.id),
        employeeName: row.employeeName,
        month: row.month,
        baseSalary: toDecimalNumber(row.baseSalary),
        leaveDeduction: toDecimalNumber(row.leaveDeduction),
        otherDeduction: toDecimalNumber(row.otherDeduction),
        bonus: toDecimalNumber(row.bonus),
        actualSalary: toDecimalNumber(row.actualSalary),
        ...(row.socialInsurance !== null
          ? { socialInsurance: toDecimalNumber(row.socialInsurance) }
          : {}),
        ...(row.housingFund !== null
          ? { housingFund: toDecimalNumber(row.housingFund) }
          : {}),
        totalLaborCost: toDecimalNumber(row.totalLaborCost),
        ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.getTime() } : {}),
      })),
    };
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
    this.assertPayrollBusinessRules(dto, month);
    const actualSalary =
      dto.baseSalary - dto.leaveDeduction - dto.otherDeduction + dto.bonus;
    const totalLaborCost =
      actualSalary + (dto.socialInsurance ?? 0) + (dto.housingFund ?? 0);

    const payroll = await this.prisma.$transaction(async (transaction) => {
      return transaction.employeePayroll.upsert({
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
    if (payroll.status === EmployeePayrollStatus.confirmed) {
      throw new ConflictException('该工资记录已确认，无需重复确认');
    }
    const confirmed = await this.prisma.$transaction(async (transaction) => {
      const nextPayroll = await transaction.employeePayroll.update({
        where: { id: payroll.id },
        data: {
          status: EmployeePayrollStatus.confirmed,
          confirmedAt: new Date(),
        },
      });
      await this.costsService.syncPayrollCosts(transaction, {
        storeId: nextPayroll.storeId,
        payrollId: nextPayroll.id,
        operatorStaffId: user.currentMembership?.staffId ?? null,
        employeeName: nextPayroll.employeeName,
        month: nextPayroll.month,
        actualSalary: toDecimalNumber(nextPayroll.actualSalary),
        socialInsurance:
          nextPayroll.socialInsurance !== null
            ? toDecimalNumber(nextPayroll.socialInsurance)
            : undefined,
        housingFund:
          nextPayroll.housingFund !== null
            ? toDecimalNumber(nextPayroll.housingFund)
            : undefined,
        note: nextPayroll.note,
      });
      return nextPayroll;
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
    if (payroll.status === EmployeePayrollStatus.confirmed) {
      throw new ConflictException('已确认结算的工资记录不支持删除');
    }
    await this.prisma.employeePayroll.delete({ where: { id: payroll.id } });
  }

  async updatePayroll(
    user: AuthenticatedUser,
    payrollId: number,
    dto: UpdateEmployeePayrollDto,
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
    if (payroll.status === EmployeePayrollStatus.confirmed) {
      throw new ConflictException('已确认结算的工资记录不能编辑');
    }

    // 合并新旧值，用于业务规则校验与派生字段计算
    const nextBaseSalary =
      dto.baseSalary !== undefined
        ? dto.baseSalary
        : toDecimalNumber(payroll.baseSalary);
    const nextLeaveDeduction =
      dto.leaveDeduction !== undefined
        ? dto.leaveDeduction
        : toDecimalNumber(payroll.leaveDeduction);
    const nextOtherDeduction =
      dto.otherDeduction !== undefined
        ? dto.otherDeduction
        : toDecimalNumber(payroll.otherDeduction);
    const nextOtherDeductionNote =
      dto.otherDeductionNote !== undefined
        ? dto.otherDeductionNote
        : (payroll.otherDeductionNote ?? undefined);
    const nextBonus =
      dto.bonus !== undefined ? dto.bonus : toDecimalNumber(payroll.bonus);
    const nextSocialInsurance =
      dto.socialInsurance !== undefined
        ? dto.socialInsurance
        : payroll.socialInsurance !== null
          ? toDecimalNumber(payroll.socialInsurance)
          : undefined;
    const nextHousingFund =
      dto.housingFund !== undefined
        ? dto.housingFund
        : payroll.housingFund !== null
          ? toDecimalNumber(payroll.housingFund)
          : undefined;

    // 业务规则校验
    if (
      nextOtherDeduction > 0 &&
      !toNullableText(nextOtherDeductionNote ?? '')
    ) {
      throw new BadRequestException('存在其他扣款时必须填写扣款说明');
    }
    const actualSalary =
      nextBaseSalary - nextLeaveDeduction - nextOtherDeduction + nextBonus;
    if (actualSalary < 0) {
      throw new BadRequestException('实发工资不能小于 0，请检查扣款与奖金');
    }
    const totalLaborCost =
      actualSalary + (nextSocialInsurance ?? 0) + (nextHousingFund ?? 0);

    const updated = await this.prisma.$transaction(async (transaction) => {
      return transaction.employeePayroll.update({
        where: { id: payroll.id },
        data: {
          ...(dto.baseSalary !== undefined
            ? { baseSalary: this.toDecimal(dto.baseSalary) }
            : {}),
          ...(dto.leaveDeduction !== undefined
            ? { leaveDeduction: this.toDecimal(dto.leaveDeduction) }
            : {}),
          ...(dto.otherDeduction !== undefined
            ? { otherDeduction: this.toDecimal(dto.otherDeduction) }
            : {}),
          ...(dto.otherDeductionNote !== undefined
            ? { otherDeductionNote: toNullableText(dto.otherDeductionNote) }
            : {}),
          ...(dto.bonus !== undefined
            ? { bonus: this.toDecimal(dto.bonus) }
            : {}),
          ...(dto.socialInsurance !== undefined
            ? {
                socialInsurance:
                  dto.socialInsurance > 0
                    ? this.toDecimal(dto.socialInsurance)
                    : null,
              }
            : {}),
          ...(dto.housingFund !== undefined
            ? {
                housingFund:
                  dto.housingFund > 0 ? this.toDecimal(dto.housingFund) : null,
              }
            : {}),
          ...(dto.note !== undefined ? { note: toNullableText(dto.note) } : {}),
          actualSalary: this.toDecimal(actualSalary),
          totalLaborCost: this.toDecimal(totalLaborCost),
        },
      });
    });

    return toEmployeePayrollResponse(updated);
  }

  private async resolveManageableStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    permission: 'staff:create' | 'staff:update',
  ): Promise<number> {
    return this.employeesAccessService.resolveSingleStoreId(
      user,
      storeId,
      permission,
    );
  }

  private async ensureDefaultDepartment(storeId: number): Promise<void> {
    await this.ensureDepartment(storeId, '综合部');
  }

  private async ensureDictionaryNameAvailable(
    type: 'department' | 'position',
    storeId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const normalizedName = name.trim();
    const where = {
      storeId,
      name: { equals: normalizedName, mode: 'insensitive' as const },
      ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
    };

    const existing =
      type === 'department'
        ? await this.prisma.employeeDepartment.findFirst({ where })
        : await this.prisma.employeePosition.findFirst({ where });

    if (existing) {
      throw new ConflictException(
        type === 'department'
          ? '已存在同名部门，请换个名称'
          : '已存在同名职位，请换个名称',
      );
    }
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
  ): Prisma.StringFilter | string | undefined {
    if (!year) {
      return undefined;
    }

    if (!month || month === 0) {
      return {
        gte: `${year}-01`,
        lte: `${year}-12`,
      };
    }

    return `${year}-${String(month).padStart(2, '0')}`;
  }

  private formatPayrollMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private formatShiftReportDate(date: Date): string {
    const weeks = ['日', '一', '二', '三', '四', '五', '六'];
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day} 周${weeks[date.getDay()]}`;
  }

  private async ensureLeaveDateRangeAvailable(
    employeeId: number,
    startDate: number,
    endDate: number,
    excludeId?: number,
  ): Promise<void> {
    const existing = await this.prisma.employeeLeave.findFirst({
      where: {
        employeeId,
        ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
        startDate: { lte: new Date(endDate) },
        endDate: { gte: new Date(startDate) },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('该员工在所选时间段内已有请假记录');
    }
  }

  private async ensureShiftScheduleAvailable(
    employeeId: number,
    date: number,
    startTime: string,
    endTime: string,
    excludeId?: number,
  ): Promise<void> {
    const currentDate = new Date(date);
    const dayStart = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate(),
      0,
      0,
      0,
      0,
    );
    const dayEnd = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate() + 1,
      0,
      0,
      0,
      0,
    );
    const sameDayShifts = await this.prisma.employeeShift.findMany({
      where: {
        employeeId,
        ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
        date: { gte: dayStart, lt: dayEnd },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
      },
    });

    if (sameDayShifts.length === 0) {
      return;
    }

    const nextStartMinutes = this.parseTimeToMinutes(
      startTime,
      '上班时间格式不正确',
    );
    const nextEndMinutes = this.parseTimeToMinutes(
      endTime,
      '下班时间格式不正确',
    );
    const hasOverlap = sameDayShifts.some((item) =>
      this.isTimeRangeOverlapping(
        nextStartMinutes,
        nextEndMinutes,
        this.parseTimeToMinutes(item.startTime, '上班时间格式不正确'),
        this.parseTimeToMinutes(item.endTime, '下班时间格式不正确'),
      ),
    );

    if (hasOverlap) {
      throw new ConflictException('该员工当天已有时间重叠的排班记录');
    }

    throw new ConflictException('该员工当天已有排班记录，不能重复排班');
  }

  private assertLeaveBusinessRules(input: {
    startDate: number;
    endDate: number;
    days: number;
    deductSalary: boolean;
    deductAmount: number;
  }): void {
    if (input.startDate > input.endDate) {
      throw new BadRequestException('请假开始时间不能晚于结束时间');
    }
    if (input.days <= 0) {
      throw new BadRequestException('请假天数必须大于 0');
    }
    if (!input.deductSalary && input.deductAmount > 0) {
      throw new BadRequestException('未扣薪的请假记录扣款金额必须为 0');
    }
  }

  private assertShiftBusinessRules(startTime: string, endTime: string): void {
    const startMinutes = this.parseTimeToMinutes(
      startTime,
      '上班时间格式不正确',
    );
    const endMinutes = this.parseTimeToMinutes(endTime, '下班时间格式不正确');

    if (startMinutes >= endMinutes) {
      throw new BadRequestException('排班上班时间必须早于下班时间');
    }
  }

  private assertPayrollBusinessRules(
    dto: SaveEmployeePayrollDto,
    month: string,
  ): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('结算月份必须是有效的 YYYY-MM 格式');
    }
    if (dto.otherDeduction > 0 && !toNullableText(dto.otherDeductionNote)) {
      throw new BadRequestException('存在其他扣款时必须填写扣款说明');
    }

    const actualSalary =
      dto.baseSalary - dto.leaveDeduction - dto.otherDeduction + dto.bonus;
    if (actualSalary < 0) {
      throw new BadRequestException('实发工资不能小于 0，请检查扣款与奖金');
    }
  }

  private parseTimeToMinutes(value: string, message: string): number {
    const matched = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!matched) {
      throw new BadRequestException(message);
    }

    return Number(matched[1]) * 60 + Number(matched[2]);
  }

  private isTimeRangeOverlapping(
    startMinutes: number,
    endMinutes: number,
    compareStartMinutes: number,
    compareEndMinutes: number,
  ): boolean {
    return startMinutes < compareEndMinutes && compareStartMinutes < endMinutes;
  }

  private toDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value);
  }
}
