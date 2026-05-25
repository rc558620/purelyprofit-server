import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateEmployeeShiftDto,
  EmployeeShiftReportResponseDto,
  EmployeeShiftResponseDto,
  ListEmployeeShiftsQueryDto,
  UpdateEmployeeShiftDto,
} from './dto/employee-shift.dto';
import {
  assertShiftBusinessRules,
  buildShiftReport,
  buildSingleDayDateRange,
  isTimeRangeOverlapping,
  parseTimeToMinutes,
} from './employees.domain';
import { EmployeesAccessService } from './employees-access.service';
import { toEmployeeShiftResponse } from './employees.mapper';
import { buildDateRange, toNullableText } from './employees.utils';

@Injectable()
export class EmployeesShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesAccessService: EmployeesAccessService,
  ) {}

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

    return buildShiftReport(rows);
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
    assertShiftBusinessRules(dto.startTime, dto.endTime);
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
    assertShiftBusinessRules(nextShiftStartTime, nextShiftEndTime);
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

  private async ensureShiftScheduleAvailable(
    employeeId: number,
    date: number,
    startTime: string,
    endTime: string,
    excludeId?: number,
  ): Promise<void> {
    const dayRange = buildSingleDayDateRange(date);
    const sameDayShifts = await this.prisma.employeeShift.findMany({
      where: {
        employeeId,
        ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
        date: dayRange,
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

    const nextStartMinutes = parseTimeToMinutes(startTime, '上班时间格式不正确');
    const nextEndMinutes = parseTimeToMinutes(endTime, '下班时间格式不正确');
    const hasOverlap = sameDayShifts.some((item) =>
      isTimeRangeOverlapping(
        nextStartMinutes,
        nextEndMinutes,
        parseTimeToMinutes(item.startTime, '上班时间格式不正确'),
        parseTimeToMinutes(item.endTime, '下班时间格式不正确'),
      ),
    );

    if (hasOverlap) {
      throw new ConflictException('该员工当天已有时间重叠的排班记录');
    }

    throw new ConflictException('该员工当天已有排班记录，不能重复排班');
  }
}
