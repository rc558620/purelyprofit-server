import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateEmployeeLeaveDto,
  EmployeeLeaveResponseDto,
  UpdateEmployeeLeaveDto,
} from './dto/employee-leave.dto';
import { EmployeesAccessService } from './employees-access.service';
import { assertLeaveBusinessRules } from './employees.domain';
import { toEmployeeLeaveResponse } from './employees.mapper';
import { toDecimalNumber, toNullableText } from './employees.utils';

@Injectable()
export class EmployeesLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
  ) {}

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
    assertLeaveBusinessRules({
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
    assertLeaveBusinessRules({
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

  private toDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value);
  }
}
