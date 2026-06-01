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
import {
  toDecimalNumber,
  toOptionalText,
  toOptionalTimestampMs,
  toTimestampMs,
} from './employees.utils';
import { toOptionalMediaText } from '../../commerce/commerce.utils';

export function toEmployeeResponse(
  employee: Employee,
  subAccount?: EmployeeSubAccountResponseDto,
): EmployeeResponseDto {
  return {
    id: String(employee.id),
    empNo: employee.empNo,
    name: employee.name,
    phone: employee.phone,
    position: employee.position,
    department: employee.department,
    joinDate: toTimestampMs(employee.joinDate),
    baseSalary: toDecimalNumber(employee.baseSalary),
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
    ...(subAccount ? { subAccount } : {}),
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
    deductAmount: toDecimalNumber(leave.deductAmount),
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
    month: payroll.month,
    baseSalary: toDecimalNumber(payroll.baseSalary),
    leaveDeduction: toDecimalNumber(payroll.leaveDeduction),
    otherDeduction: toDecimalNumber(payroll.otherDeduction),
    ...(payroll.otherDeductionNote
      ? { otherDeductionNote: payroll.otherDeductionNote }
      : {}),
    bonus: toDecimalNumber(payroll.bonus),
    actualSalary: toDecimalNumber(payroll.actualSalary),
    ...(payroll.socialInsurance !== null
      ? { socialInsurance: toDecimalNumber(payroll.socialInsurance) }
      : {}),
    ...(payroll.housingFund !== null
      ? { housingFund: toDecimalNumber(payroll.housingFund) }
      : {}),
    totalLaborCost: toDecimalNumber(payroll.totalLaborCost),
    status: payroll.status,
    ...(toOptionalTimestampMs(payroll.confirmedAt)
      ? { confirmedAt: toOptionalTimestampMs(payroll.confirmedAt) }
      : {}),
    ...(payroll.note ? { note: payroll.note } : {}),
    createdAt: toTimestampMs(payroll.createdAt),
    updatedAt: toTimestampMs(payroll.updatedAt),
  };
}
