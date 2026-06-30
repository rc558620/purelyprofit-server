import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { Money } from '../../../shared/money.utils';
import {
  CreateEmployeeLeaveDto,
  EmployeeLeaveResponseDto,
  UpdateEmployeeLeaveDto,
} from './dto/employee-leave.dto';
import { EmployeesAccessService } from './employees-access.service';
import { assertLeaveBusinessRules, calculateLeaveDays } from './employees-leave.domain';
import { toEmployeeLeaveResponse } from './employees.mapper';
import { toNullableText } from './employees.utils';

@Injectable()
export class EmployeesLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
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
      take: 200,
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
    const derivedDays = calculateLeaveDays(dto.startDate, dto.endDate);
    assertLeaveBusinessRules({
      startDate: dto.startDate,
      endDate: dto.endDate,
      days: derivedDays,
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
        days: derivedDays,
        deductSalary: dto.deductSalary,
        deductAmount: Money.fromInputYuan(dto.deductAmount).toDbCents(),
        note: toNullableText(dto.note),
      },
    });
    await this.invalidateDashboardCaches(employee.storeId);
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
    const derivedDays = calculateLeaveDays(nextLeaveStartDate, nextLeaveEndDate);
    assertLeaveBusinessRules({
      startDate: nextLeaveStartDate,
      endDate: nextLeaveEndDate,
      days: derivedDays,
      deductSalary: dto.deductSalary ?? leave.deductSalary,
      deductAmount: dto.deductAmount ?? Money.fromDbCents(leave.deductAmount).toOutputYuan(),
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
        days: derivedDays,
        ...(dto.deductSalary !== undefined
          ? { deductSalary: dto.deductSalary }
          : {}),
        ...(dto.deductAmount !== undefined
          ? { deductAmount: Money.fromInputYuan(dto.deductAmount).toDbCents() }
          : {}),
        ...(dto.note !== undefined ? { note: toNullableText(dto.note) } : {}),
      },
    });
    await this.invalidateDashboardCaches(leave.storeId);
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
    await this.invalidateDashboardCaches(leave.storeId);
  }

  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await this.cacheInvalidatorService.invalidateDashboardAndPulseSession(
      storeId,
    );
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

}
