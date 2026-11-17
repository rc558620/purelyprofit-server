// 子账号登录凭证吊销：平台侧关闭 / 收缩子账号额度时清空可重新注册，而非临时停用
import { StaffStatus, type Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';

export type SubAccountDbClient = PrismaService | Prisma.TransactionClient;

/**
 * 吊销子账号登录凭证（平台侧关闭 / 收缩子账号额度时调用）。
 *
 * 语义是「清空重新注册」而不是「临时停用」：
 * - Staff 行禁用（`isActive=false` / `status=disabled` / `isSeatActive=false`），
 *   登录查找链路按 `isActive=true` 过滤，原手机号与别名邮箱从此命中不到，
 *   表现为「账号或密码错误」；
 * - 自定义 `loginAccount` 置空（该列全局唯一），账号别名可被重新申请；
 * - `employee.linkedStaffId` 解绑，店主重新分配槽位时会走
 *   `ensureEmployeeHasLoginAccount` 重新建号改密，等价于全新子账号。
 *
 * 这里刻意不删除员工档案、User 与 Staff 行：员工仍要排班 / 交班，
 * 历史单据也通过 Staff 外键引用这些行。
 */
export async function revokeSubAccountLoginAccounts(
  db: SubAccountDbClient,
  storeId: number,
  employeeIds: number[],
): Promise<number[]> {
  const uniqueEmployeeIds = [
    ...new Set(employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (uniqueEmployeeIds.length === 0) {
    return [];
  }

  const employees = await db.employee.findMany({
    where: {
      id: { in: uniqueEmployeeIds },
      storeId,
      linkedStaffId: { not: null },
    },
    select: { linkedStaffId: true },
  });

  const staffIds = [
    ...new Set(
      employees
        .map((employee) => employee.linkedStaffId)
        .filter((id): id is number => id !== null),
    ),
  ];
  if (staffIds.length === 0) {
    return [];
  }

  await db.staff.updateMany({
    where: { id: { in: staffIds }, storeId },
    data: {
      isActive: false,
      status: StaffStatus.disabled,
      isSeatActive: false,
      loginAccount: null,
      permissions: [],
    },
  });

  await db.employee.updateMany({
    where: { linkedStaffId: { in: staffIds }, storeId },
    data: { linkedStaffId: null },
  });

  return staffIds;
}
