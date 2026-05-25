import { EmployeeGender, EmployeeStatus, Prisma } from '@prisma/client';
import { toNullableText } from './employees.utils';

export interface EmployeeProfileDictionaryRecord {
  id: number;
  name: string;
}

export interface CreateEmployeeProfileInput {
  storeId: number;
  department: EmployeeProfileDictionaryRecord;
  position: EmployeeProfileDictionaryRecord;
  empNo: string;
  name: string;
  phone: string;
  joinDate: number;
  baseSalary: number;
  avatar?: string;
  idCard?: string;
  gender?: EmployeeGender;
  emergencyContact?: string;
  emergencyPhone?: string;
  contractEndDate?: number;
  note?: string;
}

export interface UpdateEmployeeProfileInput {
  department?: EmployeeProfileDictionaryRecord;
  position?: EmployeeProfileDictionaryRecord;
  name?: string;
  phone?: string;
  joinDate?: number;
  baseSalary?: number;
  avatar?: string;
  idCard?: string;
  gender?: EmployeeGender;
  emergencyContact?: string;
  emergencyPhone?: string;
  contractEndDate?: number;
  note?: string;
}

export interface ResignEmployeeProfileInput {
  resignDate?: number;
  resignReason?: string;
}

export function buildNextEmployeeEmpNo(latestEmpNo?: string | null): string {
  const currentNumber = latestEmpNo?.match(/^EMP(\d+)$/)?.[1];
  const nextValue = (currentNumber ? Number(currentNumber) : 0) + 1;
  return `EMP${String(nextValue).padStart(3, '0')}`;
}

export function buildCreateEmployeeProfileData(
  input: CreateEmployeeProfileInput,
): Prisma.EmployeeUncheckedCreateInput {
  return {
    storeId: input.storeId,
    departmentId: input.department.id,
    positionId: input.position.id,
    empNo: input.empNo,
    name: input.name.trim(),
    phone: input.phone.trim(),
    position: input.position.name,
    department: input.department.name,
    joinDate: new Date(input.joinDate),
    baseSalary: new Prisma.Decimal(input.baseSalary),
    avatar: toNullableText(input.avatar),
    idCard: toNullableText(input.idCard),
    gender: input.gender ?? EmployeeGender.unset,
    emergencyContact: toNullableText(input.emergencyContact),
    emergencyPhone: toNullableText(input.emergencyPhone),
    contractEndDate: input.contractEndDate
      ? new Date(input.contractEndDate)
      : undefined,
    note: toNullableText(input.note),
    status: EmployeeStatus.active,
  };
}

export function buildUpdateEmployeeProfileData(
  input: UpdateEmployeeProfileInput,
): Prisma.EmployeeUncheckedUpdateInput {
  return {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}),
    ...(input.department
      ? {
          departmentId: input.department.id,
          department: input.department.name,
        }
      : {}),
    ...(input.position
      ? {
          positionId: input.position.id,
          position: input.position.name,
        }
      : {}),
    ...(input.joinDate !== undefined
      ? { joinDate: new Date(input.joinDate) }
      : {}),
    ...(input.baseSalary !== undefined
      ? { baseSalary: new Prisma.Decimal(input.baseSalary) }
      : {}),
    ...(input.avatar !== undefined
      ? { avatar: toNullableText(input.avatar) }
      : {}),
    ...(input.idCard !== undefined
      ? { idCard: toNullableText(input.idCard) }
      : {}),
    ...(input.gender !== undefined ? { gender: input.gender } : {}),
    ...(input.emergencyContact !== undefined
      ? { emergencyContact: toNullableText(input.emergencyContact) }
      : {}),
    ...(input.emergencyPhone !== undefined
      ? { emergencyPhone: toNullableText(input.emergencyPhone) }
      : {}),
    ...(input.contractEndDate !== undefined
      ? {
          contractEndDate: input.contractEndDate
            ? new Date(input.contractEndDate)
            : null,
        }
      : {}),
    ...(input.note !== undefined ? { note: toNullableText(input.note) } : {}),
  };
}

export function buildResignEmployeeProfileData(
  input: ResignEmployeeProfileInput,
): Prisma.EmployeeUncheckedUpdateInput {
  return {
    status: EmployeeStatus.resigned,
    resignDate: input.resignDate ? new Date(input.resignDate) : new Date(),
    resignReason: toNullableText(input.resignReason),
  };
}
