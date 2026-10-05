import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildPhoneLoginEmail } from '../../auth/auth.utils';

export type PrismaClientOrTransaction =
  | PrismaService
  | Prisma.TransactionClient;

@Injectable()
export class StoreSubAccountConflictCheckService {
  /**
   * 全局唯一性预检：
   * 1. loginAccount（email）跨所有门店的 active Staff 唯一
   * 2. 手机号不与已注册的其他主账号冲突
   */
  async checkEmailAndPhoneConflicts(
    db: PrismaClientOrTransaction,
    storeId: number,
    nextStaffEmail: string,
    phone: string,
    loginAccount: string | null,
    excludeStaffId: number | null,
    excludeUserId: number | null,
  ): Promise<void> {
    // 1. loginAccount（email）全局唯一：
    //    - active Staff 跨所有门店占用账号（与数据库部分唯一索引
    //      staffs_active_email_unique 的口径保持一致）；
    //    - 已禁用（isActive=false）的 Staff 不占用账号：
    //      * 同门店的禁用残留行（子账号被关闭后遗留）由
    //        ensureEmployeeHasLoginAccount 的复用逻辑接管，重新保存设置
    //        会直接复用该行，因此不算冲突（excludeStaffId 为空的新建链路）；
    //      * 已关联 Staff 的更新链路（excludeStaffId 非空）无法走复用，
    //        同门店其他禁用行仍视为冲突，避免后续 update 撞
    //        @@unique([storeId, email]) 抛 500；
    //      * 跨门店的禁用行不受任何唯一约束，一律不算冲突。
    //    excludeStaffId 排除当前员工自己的 Staff，避免不变更 email 时误报冲突
    const emailConflict = await db.staff.findFirst({
      where: {
        email: nextStaffEmail,
        ...(excludeStaffId ? { id: { not: excludeStaffId } } : {}),
        OR: [
          { isActive: true },
          ...(excludeStaffId ? [{ isActive: false, storeId }] : []),
        ],
      },
      select: { id: true },
    });

    if (emailConflict) {
      throw new ConflictException('该账号已被注册');
    }

    // 2. 手机号门店级唯一（仅当同门店无同手机号 Staff 时视为冲突）
    //    同门店同手机号 Staff 关联的 User 可复用，不算冲突
    const phoneEmail = buildPhoneLoginEmail('purely_profit', phone);
    const reusableUserIds = await db.staff.findMany({
      where: {
        storeId,
        phone,
        userId: { not: null },
      },
      select: { userId: true },
    });
    const excludeUserIds = [
      ...new Set(
        [
          ...(excludeUserId ? [excludeUserId] : []),
          ...reusableUserIds.map((s) => s.userId!),
        ].filter(Boolean),
      ),
    ];

    // 若本门店已有同手机号 Staff 关联的 User，说明可复用，无需冲突检查
    if (reusableUserIds.length === 0) {
      const phoneWhere =
        excludeUserIds.length > 0
          ? { email: phoneEmail, id: { notIn: excludeUserIds } }
          : { email: phoneEmail };

      const phoneConflict = await db.user.findFirst({
        where: phoneWhere,
        select: { id: true },
      });

      if (phoneConflict) {
        throw new ConflictException('该电话号码已被其他主账号注册');
      }
    }
  }
}
