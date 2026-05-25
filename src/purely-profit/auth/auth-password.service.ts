import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { PhoneUserRecord } from './auth-account.types';
import type {
  CreateUserFromPhoneParams,
  UpdateUserPasswordParams,
} from './auth-password.types';
import { buildAccountIdentifiers } from './auth.utils';

@Injectable()
export class AuthPasswordService {
  constructor(private readonly prisma: PrismaService) {}

  async createUserFromPhone(
    params: CreateUserFromPhoneParams,
  ): Promise<{ id: number; email: string }> {
    const accountIdentifiers = buildAccountIdentifiers(params.phone);
    const hashedPassword = await bcrypt.hash(params.password, 10);

    return this.prisma.user.create({
      data: {
        email: accountIdentifiers.email,
        password: hashedPassword,
        name: params.name,
      },
      select: {
        id: true,
        email: true,
      },
    });
  }

  async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  async changePassword(
    params: UpdateUserPasswordParams,
  ): Promise<{ id: number; email: string }> {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    if (!currentUser) {
      throw new UnauthorizedException('用户不存在');
    }

    const isCurrentPasswordValid = await this.verifyPassword(
      params.currentPassword,
      currentUser.password,
    );
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('当前密码错误');
    }

    await this.updatePassword(currentUser.id, params.newPassword);

    return {
      id: currentUser.id,
      email: currentUser.email,
    };
  }

  async resetPassword(user: PhoneUserRecord, newPassword: string): Promise<void> {
    const isSamePassword = await this.verifyPassword(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }

    await this.updatePassword(user.id, newPassword);
  }

  private async updatePassword(userId: number, password: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }
}
