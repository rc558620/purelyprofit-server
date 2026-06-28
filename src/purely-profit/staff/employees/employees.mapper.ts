import type {
  Employee,
  EmployeeDepartment,
  EmployeeLeave,
  EmployeePayroll,
  EmployeePosition,
  EmployeeShift,
  EmployeeShiftDefinition,
} from '@prisma/client';
import {
  EmployeeDepartmentResponseDto,
  EmployeePositionResponseDto,
} from './dto/employee-dictionary.dto';
import { EmployeeLeaveResponseDto } from './dto/employee-leave.dto';
import { EmployeePayrollResponseDto } from './dto/employee-payroll.dto';
import {
  EmployeeResponseDto,
  type EmployeeSubAccountResponseDto,
} from './dto/employee-response.dto';
import { EmployeeShiftResponseDto } from './dto/employee-shift.dto';
import { EmployeeShiftDefinitionResponseDto } from './dto/employee-shift-definition.dto';
import { Money } from '../../../shared/money.utils';
import {
  toOptionalMediaText,
  toOptionalText,
  toOptionalTimestampMs,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { formatPayrollMonth } from './employees-payroll.domain';
import {
  buildPaginationMeta,
  normalizeMonthValue,
  toDecimalNumber,
} from './employees.utils';

export interface EmployeeResponseViewOptions {
  canViewSubAccountModule?: boolean;
  canResign?: boolean;
}

export function toEmployeeResponse(
  employee: Employee,
  subAccount?: EmployeeSubAccountResponseDto,
  viewOptions?: EmployeeResponseViewOptions,
): EmployeeResponseDto {
  const canViewSubAccountModule =
    viewOptions?.canViewSubAccountModule ?? undefined;

  return {
    id: String(employee.id),
    empNo: employee.empNo,
    name: employee.name,
    phone: employee.phone,
    position: employee.position,
    department: employee.department,
    joinDate: toTimestampMs(employee.joinDate),
    baseSalary: Money.fromDbCents(employee.baseSalary).toOutputYuan(),
    ...(toOptionalMediaText(employee.avatar)
      ? { avatar: toOptionalMediaText(employee.avatar) }
      : {}),
    ...(employee.idCard ? { idCard: employee.idCard } : {}),
    gender: employee.gender,
    ...(employee.emergencyContact
      ? { emergencyContact: employee.emergencyContact }
      : {}),
    ...(employee.emergencyPhone
      ? { emergencyPhone: employee.emergencyPhone }
      : {}),
    ...(employee.contractEndDate
      ? { contractEndDate: toTimestampMs(employee.contractEndDate) }
      : {}),
    ...(employee.note ? { note: employee.note } : {}),
    status: employee.status,
    ...(employee.resignDate
      ? { resignDate: toTimestampMs(employee.resignDate) }
      : {}),
    ...(employee.resignReason ? { resignReason: employee.resignReason } : {}),
    createdAt: toTimestampMs(employee.createdAt),
    updatedAt: toTimestampMs(employee.updatedAt),
    ...(canViewSubAccountModule !== undefined
      ? { canViewSubAccountModule }
      : {}),
    ...(viewOptions?.canResign !== undefined
      ? { canResign: viewOptions.canResign }
      : {}),
    ...(subAccount && canViewSubAccountModule !== false ? { subAccount } : {}),
  };
}

export function toEmployeeDepartmentResponse(
  department: EmployeeDepartment,
): EmployeeDepartmentResponseDto {
  return {
    id: String(department.id),
    name: department.name,
    createdAt: toTimestampMs(department.createdAt),
    ...(department.updatedAt
      ? { updatedAt: toTimestampMs(department.updatedAt) }
      : {}),
  };
}

export function toEmployeePositionResponse(
  position: EmployeePosition,
): EmployeePositionResponseDto {
  return {
    id: String(position.id),
    name: position.name,
    createdAt: toTimestampMs(position.createdAt),
    ...(position.updatedAt
      ? { updatedAt: toTimestampMs(position.updatedAt) }
      : {}),
  };
}

export function toEmployeeShiftDefinitionResponse(
  definition: EmployeeShiftDefinition,
): EmployeeShiftDefinitionResponseDto {
  return {
    id: String(definition.id),
    name: definition.name,
    defaultStartTime: definition.defaultStartTime,
    defaultEndTime: definition.defaultEndTime,
    createdAt: toTimestampMs(definition.createdAt),
    updatedAt: toTimestampMs(definition.updatedAt),
  };
}

export function toEmployeeLeaveResponse(
  leave: EmployeeLeave,
): EmployeeLeaveResponseDto {
  return {
    id: String(leave.id),
    employeeId: String(leave.employeeId),
    employeeName: leave.employeeName,
    type: leave.type,
    startDate: toTimestampMs(leave.startDate),
    endDate: toTimestampMs(leave.endDate),
    days: toDecimalNumber(leave.days),
    deductSalary: leave.deductSalary,
    deductAmount: Money.fromDbCents(leave.deductAmount).toOutputYuan(),
    ...(toOptionalText(leave.note) ? { note: leave.note ?? undefined } : {}),
    createdAt: toTimestampMs(leave.createdAt),
  };
}

export function toEmployeeShiftResponse(
  shift: EmployeeShift,
): EmployeeShiftResponseDto {
  return {
    id: String(shift.id),
    employeeId: String(shift.employeeId),
    employeeName: shift.employeeName,
    date: toTimestampMs(shift.date),
    ...(shift.shiftDefinitionId !== null
      ? { shiftDefinitionId: String(shift.shiftDefinitionId) }
      : {}),
    shiftName: shift.shiftName,
    startTime: shift.startTime,
    endTime: shift.endTime,
    ...(shift.note ? { note: shift.note } : {}),
    createdAt: toTimestampMs(shift.createdAt),
  };
}

export function toEmployeePayrollResponse(
  payroll: EmployeePayroll,
): EmployeePayrollResponseDto {
  return {
    id: String(payroll.id),
    employeeId: String(payroll.employeeId),
    employeeName: payroll.employeeName,
    month: formatPayrollMonth(payroll.month),
    // 数据库存储分，用 Money.fromDbCents 读出后 toOutputYuan 返回
    baseSalary: Money.fromDbCents(payroll.baseSalary).toOutputYuan(),
    leaveDeduction: Money.fromDbCents(payroll.leaveDeduction).toOutputYuan(),
    otherDeduction: Money.fromDbCents(payroll.otherDeduction).toOutputYuan(),
    ...(payroll.otherDeductionNote
      ? { otherDeductionNote: payroll.otherDeductionNote }
      : {}),
    bonus: Money.fromDbCents(payroll.bonus).toOutputYuan(),
    actualSalary: Money.fromDbCents(payroll.actualSalary).toOutputYuan(),
    ...(payroll.socialInsurance > 0
      ? { socialInsurance: Money.fromDbCents(payroll.socialInsurance).toOutputYuan() }
      : {}),
    ...(payroll.housingFund > 0
      ? { housingFund: Money.fromDbCents(payroll.housingFund).toOutputYuan() }
      : {}),
    totalLaborCost: Money.fromDbCents(payroll.totalLaborCost).toOutputYuan(),
    status: payroll.status,
    ...(toOptionalTimestampMs(payroll.confirmedAt)
      ? { confirmedAt: toOptionalTimestampMs(payroll.confirmedAt) }
      : {}),
    ...(payroll.note ? { note: payroll.note } : {}),
    createdAt: toTimestampMs(payroll.createdAt),
    updatedAt: toTimestampMs(payroll.updatedAt),
  };
}
