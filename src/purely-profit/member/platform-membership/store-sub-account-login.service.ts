import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StaffRole, StaffStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  buildAccountIdentifiers,
  buildLoginEmailFromAccount,
  isValidSubAccountLoginAccount,
} from '../../auth/auth.utils';

interface EnsureEmployeeSubAccountLoginInput {
  password?: string;
  loginAccount?: string;
}

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
  ): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
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

    if (employee.linkedStaff) {
      if (nextLoginEmail) {
        await this.ensureLoginAccountAvailable(
          employee.linkedStaff.id,
          nextLoginEmail,
        );
      }

      if (!employee.linkedStaff.userId) {
        if (!normalizedPassword) {
          throw new BadRequestException('首次设置子账号时必须填写登录密码');
        }

        const user = await this.createOrFindUser(
          employee.phone,
          employee.name ?? `员工${employee.id}`,
          normalizedPassword,
        );
        await this.prisma.staff.update({
          where: { id: employee.linkedStaff.id },
          data: {
            userId: user.id,
            ...(nextLoginEmail ? { email: nextLoginEmail } : {}),
          },
        });
        return;
      }

      if (nextLoginEmail && employee.linkedStaff.email !== nextLoginEmail) {
        await this.prisma.staff.update({
          where: { id: employee.linkedStaff.id },
          data: { email: nextLoginEmail },
        });
      }

      if (normalizedPassword) {
        await this.updateUserPassword(
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
      employee.phone,
      employee.name ?? `员工${employee.id}`,
      normalizedPassword,
    );

    const nextStaffEmail =
      nextLoginEmail ??
      buildAccountIdentifiers('purely_profit', employee.phone).email;

    const existingStaff = await this.prisma.staff.findFirst({
      where: {
        phone: employee.phone,
        storeId,
      },
      select: { id: true, userId: true },
    });

    if (existingStaff) {
      await this.ensureLoginAccountAvailable(existingStaff.id, nextStaffEmail);
      await this.prisma.staff.update({
        where: { id: existingStaff.id },
        data: {
          ...(existingStaff.userId ? {} : { userId: user.id }),
          email: nextStaffEmail,
        },
      });
      await this.prisma.employee.update({
        where: { id: employeeId },
        data: { linkedStaffId: existingStaff.id },
      });
      return;
    }

    const newStaff = await this.prisma.staff.create({
      data: {
        storeId,
        userId: user.id,
        email: nextStaffEmail,
        name: employee.name ?? `员工${employee.id}`,
        phone: employee.phone,
        role: StaffRole.staff,
        permissions: [],
        status: StaffStatus.active,
        isSeatActive: true,
        isActive: true,
      },
    });
    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { linkedStaffId: newStaff.id },
    });
  }

  private async ensureLoginAccountAvailable(
    currentStaffId: number,
    loginEmail: string,
  ): Promise<void> {
    const conflictStaff = await this.prisma.staff.findFirst({
      where: {
        email: loginEmail,
        id: { not: currentStaffId },
      },
      select: { id: true },
    });

    if (conflictStaff) {
      throw new ConflictException('登录账号已被其他员工使用');
    }
  }

  /**
   * 创建新 User 或查找已存在的 User（通过手机号别名邮箱）
   */
  private async createOrFindUser(
    phone: string,
    name: string,
    password: string,
  ): Promise<{ id: number }> {
    const aliasEmail = buildAccountIdentifiers('purely_profit', phone).email;

    const existingStaffWithUser = await this.prisma.staff.findFirst({
      where: {
        phone,
        userId: { not: null },
      },
      select: {
        user: {
          select: { id: true },
        },
      },
    });

    if (existingStaffWithUser?.user) {
      await this.updateUserPassword(existingStaffWithUser.user.id, password);
      return existingStaffWithUser.user;
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: aliasEmail },
      select: { id: true },
    });

    if (existingUser) {
      await this.updateUserPassword(existingUser.id, password);
      return existingUser;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: {
        email: aliasEmail,
        password: hashedPassword,
        name,
      },
      select: { id: true },
    });
  }

  /**
   * 更新用户密码
   */
  private async updateUserPassword(
    userId: number,
    password: string,
  ): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }
}
