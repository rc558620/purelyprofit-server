import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_PASSWORD_SALT_ROUNDS } from './auth.constants';
import type { PhoneUserRecord } from './auth-account.types';
import type {
  CreatedUserFromPhoneRecord,
  CreateUserFromPhoneParams,
  CreateUserFromWechatParams,
  UpdateUserPasswordParams,
} from './auth-password.types';
import { buildAccountIdentifiers } from './auth.utils';

@Injectable()
export class AuthPasswordService {
  constructor(private readonly prisma: PrismaService) {}

  async createUserFromPhone(
    params: CreateUserFromPhoneParams,
  ): Promise<CreatedUserFromPhoneRecord> {
    const accountIdentifiers = buildAccountIdentifiers(
      params.productScope,
      params.phone,
    );
    const hashedPassword = await bcrypt.hash(
      params.password,
      AUTH_PASSWORD_SALT_ROUNDS,
    );

    const user = await this.prisma.user.create({
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

    return {
      ...user,
      accountScope: params.productScope,
    };
  }

  /**
   * 通过微信 openid 创建 purely-club 用户。
   *
   * 微信用户无登录密码，使用随机 32 字节字符串做 bcrypt 哈希占位，
   * 该密码永远不会回传给前端，也无法通过手机号密码入口登录。
   * email 字段使用 `club_wechat_{openid}@purelyprofit.local` 格式保持唯一性。
   */
  async createUserFromWechat(
    params: CreateUserFromWechatParams,
  ): Promise<CreatedUserFromPhoneRecord> {
    // 生成随机占位密码（微信用户不使用密码登录，但字段 NOT NULL 需要填充）
    const randomPassword = randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(
      randomPassword,
      AUTH_PASSWORD_SALT_ROUNDS,
    );

    const wechatEmail = `club_wechat_${params.openid}@purelyprofit.local`;

    const user = await this.prisma.user.create({
      data: {
        email: wechatEmail,
        password: hashedPassword,
        name: params.nickname,
        avatar: params.avatar,
        wechatOpenid: params.openid,
        wechatUnionid: params.unionid,
        wechatNickname: params.nickname,
        wechatAvatar: params.avatar,
        // 若前端传入了真实手机号，直接写入 wechat_phone 字段
        ...(params.phone ? { wechatPhone: params.phone } : {}),
      },
      select: {
        id: true,
        email: true,
      },
    });

    return {
      ...user,
      accountScope: params.productScope,
    };
  }

  async verifyPassword(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
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

  async resetPassword(
    user: PhoneUserRecord,
    newPassword: string,
  ): Promise<void> {
    const isSamePassword = await this.verifyPassword(
      newPassword,
      user.password,
    );
    if (isSamePassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }

    await this.updatePassword(user.id, newPassword);
  }

  private async updatePassword(
    userId: number,
    password: string,
  ): Promise<void> {
    const hashedPassword = await bcrypt.hash(
      password,
      AUTH_PASSWORD_SALT_ROUNDS,
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }
}
