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
    // 1. loginAccount 全局唯一（跨所有门店、含禁用 Staff，防止禁用态历史数据错配）
    //    excludeStaffId 排除当前员工自己的 Staff，避免不变更 email 时误报冲突
    const emailWhere = excludeStaffId
      ? { email: nextStaffEmail, id: { not: excludeStaffId } }
      : { email: nextStaffEmail };

    const emailConflict = await db.staff.findFirst({
      where: emailWhere,
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
