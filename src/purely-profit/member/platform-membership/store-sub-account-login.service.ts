import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StaffRole, StaffStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  buildAccountIdentifiers,
  buildLoginEmailFromAccount,
  buildPhoneLoginEmail,
  isValidSubAccountLoginAccount,
} from '../../auth/auth.utils';

interface EnsureEmployeeSubAccountLoginInput {
  loginAccount?: string;
  password?: string;
}

type PrismaClientOrTransaction = PrismaService | Prisma.TransactionClient;

@Injectable()
export class StoreSubAccountLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 确保员工有对应的登录账号（User + Staff）
   * 支持按手机号登录，也支持通过自定义账号别名登录。
   */
  async ensureEmployeeHasLoginAccount(
    storeId: number,
    employeeId: number,
    input: EnsureEmployeeSubAccountLoginInput,
    db: PrismaClientOrTransaction = this.prisma,
  ): Promise<void> {
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        phone: true,
        name: true,
        linkedStaffId: true,
        linkedStaff: {
          select: {
            id: true,
            userId: true,
            email: true,
            user: {
              select: {
                id: true,
                password: true,
              },
            },
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    if (!employee.phone) {
      throw new BadRequestException('员工手机号为空，无法创建登录账号');
    }

    const normalizedPassword = input.password?.trim();
    const normalizedLoginAccount = input.loginAccount?.trim();

    if (
      normalizedLoginAccount !== undefined &&
      normalizedLoginAccount.length > 0 &&
      !isValidSubAccountLoginAccount(
        normalizedLoginAccount,
        this.configService.get<string>('auth.adminLoginAlias') ?? 'admin',
      )
    ) {
      throw new BadRequestException(
        '登录账号仅支持 6~32 位字母、数字或下划线，且不可使用保留账号',
      );
    }

    const nextLoginEmail = normalizedLoginAccount
      ? buildLoginEmailFromAccount('purely_profit', normalizedLoginAccount)
      : null;

    const nextStaffEmail =
      nextLoginEmail ??
      buildAccountIdentifiers('purely_profit', employee.phone).email;

    // ── 全局唯一性预检：loginAccount 跨门店唯一 + 手机号不与已注册主账号冲突 ──
    const excludeUserId = employee.linkedStaff?.userId ?? null;
    const excludeStaffId = employee.linkedStaff?.id ?? null;
    await this.checkEmailAndPhoneConflicts(
      db,
      storeId,
      nextStaffEmail,
      employee.phone,
      normalizedLoginAccount || null,
      excludeStaffId,
      excludeUserId,
    );

    if (employee.linkedStaff) {
      if (!employee.linkedStaff.userId) {
        if (!normalizedPassword) {
          throw new BadRequestException('首次设置子账号时必须填写登录密码');
        }

        const user = await this.createOrFindUser(
          db,
          storeId,
          employee.phone,
          employee.name ?? `员工${employee.id}`,
          normalizedPassword,
        );
        await db.staff.update({
          where: { id: employee.linkedStaff.id },
          data: {
            userId: user.id,
            ...(nextLoginEmail
              ? {
                  email: nextLoginEmail,
                  loginAccount: normalizedLoginAccount || null,
                }
              : {}),
          },
        });
        return;
      }

      if (nextLoginEmail && employee.linkedStaff.email !== nextLoginEmail) {
        await db.staff.update({
          where: { id: employee.linkedStaff.id },
          data: {
            email: nextLoginEmail,
            loginAccount: normalizedLoginAccount || null,
          },
        });
      }

      if (normalizedPassword) {
        // @unique(userId) 保证一个 User 最多关联一条 Staff，无需凭证隔离
        await this.updateUserPassword(
          db,
          employee.linkedStaff.userId,
          normalizedPassword,
        );
      }
      return;
    }

    if (!normalizedPassword) {
      throw new BadRequestException('首次设置子账号时必须填写登录密码');
    }

    const user = await this.createOrFindUser(
      db,
      storeId,
      employee.phone,
      employee.name ?? `员工${employee.id}`,
      normalizedPassword,
    );

    const existingStaff = await db.staff.findFirst({
      where: {
        phone: employee.phone,
        storeId,
        isActive: true,
      },
      select: { id: true, userId: true },
    });

    if (existingStaff) {
      // 防止抢挂：若该 Staff 已被其他活跃员工关联，则拒绝复用
      const otherLinkedEmployee = await db.employee.findFirst({
        where: {
          linkedStaffId: existingStaff.id,
          id: { not: employeeId },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (otherLinkedEmployee) {
        throw new ConflictException('该手机号已被其他员工关联');
      }

      await db.staff.update({
        where: { id: existingStaff.id },
        data: {
          ...(existingStaff.userId ? {} : { userId: user.id }),
          email: nextStaffEmail,
          loginAccount: normalizedLoginAccount || null,
        },
      });
      // 先清除旧 Employee 对该 Staff 的关联（如已离职员工残留的 linkedStaffId）
      await db.employee.updateMany({
        where: { linkedStaffId: existingStaff.id },
        data: { linkedStaffId: null },
      });
      await db.employee.update({
        where: { id: employeeId },
        data: { linkedStaffId: existingStaff.id },
      });
      return;
    }

    // 查找同门店中 email 相同但已禁用的 Staff（前员工离职后残留），复用而非新建
    const disabledStaffWithEmail = await db.staff.findFirst({
      where: {
        storeId,
        email: nextStaffEmail,
        isActive: false,
      },
      select: { id: true, userId: true },
    });

    if (disabledStaffWithEmail) {
      // 先清除旧 Employee 对该 Staff 的关联（如已离职员工残留的 linkedStaffId）
      await db.employee.updateMany({
        where: { linkedStaffId: disabledStaffWithEmail.id },
        data: { linkedStaffId: null },
      });

      await db.staff.update({
        where: { id: disabledStaffWithEmail.id },
        data: {
          userId: user.id,
          name: employee.name ?? `员工${employee.id}`,
          phone: employee.phone,
          status: StaffStatus.active,
          isSeatActive: true,
          isActive: true,
          loginAccount: normalizedLoginAccount || null,
        },
      });
      await db.employee.update({
        where: { id: employeeId },
        data: { linkedStaffId: disabledStaffWithEmail.id },
      });
      return;
    }

    try {
      const newStaff = await db.staff.create({
        data: {
          storeId,
          userId: user.id,
          email: nextStaffEmail,
          loginAccount: normalizedLoginAccount || null,
          name: employee.name ?? `员工${employee.id}`,
          phone: employee.phone,
          role: StaffRole.staff,
          permissions: [],
          status: StaffStatus.active,
          isSeatActive: true,
          isActive: true,
        },
      });
      await db.employee.update({
        where: { id: employeeId },
        data: { linkedStaffId: newStaff.id },
      });
    } catch (error: unknown) {
      // 并发竞争兜底：预检通过后另一个请求抢先写入同 email
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('该账号已被注册，请重试');
      }
      throw error;
    }
  }

  /**
   * 全局唯一性预检：
   * 1. loginAccount（email）跨所有门店的 active Staff 唯一
   * 2. 手机号不与已注册的其他主账号冲突
   */
  private async checkEmailAndPhoneConflicts(
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

  /**
   * 创建新 User 或查找已存在的 User（通过手机号别名邮箱）
   */
  private async createOrFindUser(
    db: PrismaClientOrTransaction,
    storeId: number,
    phone: string,
    name: string,
    password: string,
  ): Promise<{ id: number }> {
    const aliasEmail = buildAccountIdentifiers('purely_profit', phone).email;

    // 优先复用本门店同手机号 Staff 关联的 User（更新密码）
    const sameStoreStaff = await db.staff.findFirst({
      where: {
        phone,
        storeId,
        userId: { not: null },
      },
      select: {
        user: {
          select: { id: true },
        },
      },
    });

    if (sameStoreStaff?.user) {
      await this.updateUserPassword(db, sameStoreStaff.user.id, password);
      return sameStoreStaff.user;
    }

    // 本门店无同手机号 User，创建新用户
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      return await db.user.create({
        data: {
          email: aliasEmail,
          password: hashedPassword,
          name,
        },
        select: { id: true },
      });
    } catch (error: unknown) {
      // 并发竞态兜底：预检通过后另一请求抢先创建同 email 的 User
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('该手机号已被注册，请重试');
      }
      throw error;
    }
  }

  /**
   * 更新用户密码
   */
  private async updateUserPassword(
    db: PrismaClientOrTransaction,
    userId: number,
    password: string,
  ): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }
}
