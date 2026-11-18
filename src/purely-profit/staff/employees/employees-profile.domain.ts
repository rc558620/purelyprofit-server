import { EmployeeGender, EmployeeStatus, type Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
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
  /// 是否参与提成：不传时回落 false（新增员工默认不是服务人员）
  isTechnician?: boolean;
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
  /// 是否参与提成：不传表示不更新该字段
  isTechnician?: boolean;
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

/** 解析工号中的自增序号；非 EMP<数字> 形式的工号视为 0，不参与发号基准 */
function parseEmployeeEmpNoSequence(empNo: string | null | undefined): number {
  const matched = empNo?.match(/^EMP(\d+)$/)?.[1];
  return matched ? Number(matched) : 0;
}

export function buildNextEmployeeEmpNo(latestEmpNo?: string | null): string {
  const nextValue = parseEmployeeEmpNoSequence(latestEmpNo) + 1;
  return `EMP${String(nextValue).padStart(3, '0')}`;
}

/**
 * 按门店全部存量工号（含已软删除员工）取最大序号 +1 发号。
 *
 * 必须覆盖软删除行：工号唯一约束包含历史行，若只看未删除员工，
 * 删除最大号员工后会生成一个仍被历史行占用的工号，创建时必然撞唯一约束。
 */
export function resolveNextEmployeeEmpNo(
  existingEmpNos: readonly string[],
): string {
  const latestNumber = existingEmpNos.reduce(
    (max, empNo) => Math.max(max, parseEmployeeEmpNoSequence(empNo)),
    0,
  );
  return `EMP${String(latestNumber + 1).padStart(3, '0')}`;
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
    isTechnician: input.isTechnician ?? false,
    joinDate: new Date(input.joinDate),
    baseSalary: Money.fromInputYuan(input.baseSalary).toDbCents(),
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
    ...(input.isTechnician !== undefined
      ? { isTechnician: input.isTechnician }
      : {}),
    ...(input.joinDate !== undefined
      ? { joinDate: new Date(input.joinDate) }
      : {}),
    ...(input.baseSalary !== undefined
      ? { baseSalary: Money.fromInputYuan(input.baseSalary).toDbCents() }
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
