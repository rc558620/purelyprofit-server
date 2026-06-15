import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AccountIdentifiers,
  AuthProductScope,
  PhoneUserRecord,
} from './auth-account.types';
import type { ProfileUserRecord } from './auth-profile.types';
import { ADMIN_LOGIN_PHONE } from './auth.constants';
import {
  buildAccountLoginEmails,
  buildClubWechatMemberPhone,
  buildPhoneLoginEmails,
  resolveLoginEmail,
  resolveLoginPhone,
} from './auth.utils';

@Injectable()
export class AuthAccountLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByLoginAccount(
    account: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    const loginPhone = resolveLoginPhone(account);
    if (loginPhone) {
      return this.findUserByPhone(loginPhone, productScope);
    }

    const loginEmail = resolveLoginEmail(productScope, account);
    if (!loginEmail) {
      return null;
    }

    return this.findProfitUserByLoginEmails(
      buildAccountLoginEmails('purely_profit', account),
    );
  }

  async findUserByEmail(
    email: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    if (productScope !== 'purely_profit') {
      return null;
    }

    return this.findProfitUserByLoginEmails([email]);
  }

  async findUserByPhone(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    if (phone === ADMIN_LOGIN_PHONE) {
      const developer = await this.findDeveloperUserByPhone(phone);
      if (developer) {
        return developer;
      }
    }

    if (productScope === 'purely_profit') {
      const staff = await this.prisma.staff.findFirst({
        where: {
          phone,
          isActive: true,
          userId: { not: null },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          user: {
            select: {
              id: true,
              email: true,
              password: true,
            },
          },
        },
      });

      if (staff?.user) {
        return {
          ...staff.user,
          phone,
          accountScope: 'purely_profit',
        };
      }
    }

    if (productScope === 'purely_club') {
      const wechatBoundUser = await this.prisma.user.findFirst({
        where: { wechatPhone: phone },
        select: {
          id: true,
          email: true,
          password: true,
        },
      });

      if (wechatBoundUser) {
        return {
          ...wechatBoundUser,
          phone,
          accountScope: 'purely_club',
        };
      }
    }

    const candidateEmails = buildPhoneLoginEmails(productScope, phone);
    const user = await this.prisma.user.findFirst({
      where: { email: { in: candidateEmails } },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    if (!user) {
      return null;
    }

    return {
      ...user,
      phone,
      accountScope: productScope,
    };
  }

  /**
   * 通过微信 openid 查找 purely-club 用户
   * openid 在 users 表中有唯一索引，直接精确查找
   */
  async findUserByWechatOpenid(
    openid: string,
  ): Promise<PhoneUserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { wechatOpenid: openid },
      select: {
        id: true,
        email: true,
        password: true,
        wechatPhone: true,
      },
    });

    if (!user) {
      return null;
    }

    // 优先使用微信授权拿到的真实手机号（wechat_phone），
    // 保证微信登录与手机号登录使用同一个 phone 标识，确保会员数据一致。
    // 若尚未绑定真实手机号（历史账号或未授权），则回退到 openid 派生标识。
    const { wechatPhone, ...userWithoutPhone } = user;
    return {
      ...userWithoutPhone,
      phone: wechatPhone ?? buildClubWechatMemberPhone(openid),
      accountScope: 'purely_club',
    };
  }

  /**
   * 更新微信用户的头像和昵称（微信用户已存在时刷新信息）
   */
  async updateWechatProfile(
    userId: number,
    params: { nickname?: string; avatar?: string; unionid?: string },
  ): Promise<void> {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        avatar: true,
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(params.nickname != null && {
          wechatNickname: params.nickname,
          // 仅在还没有通用昵称时回填，避免覆盖用户在站内主动修改的昵称
          ...(currentUser?.name ? {} : { name: params.nickname }),
        }),
        ...(params.avatar != null && {
          wechatAvatar: params.avatar,
          // 仅在还没有通用头像时回填，避免覆盖用户在站内主动修改的头像
          ...(currentUser?.avatar ? {} : { avatar: params.avatar }),
        }),
        ...(params.unionid != null && { wechatUnionid: params.unionid }),
      },
    });
  }

  /**
   * 将微信授权手机号写入 wechat_phone 字段（用于账号体系打通后的查找）
   *
   * 该手机号从 open-type=getPhoneNumber 回调中解密获得，代表用户微信绑定的真实手机号。
   * 写入后 findUserByPhone 会优先命中 wechat_phone，实现微信与手机号登录互通。
   */
  async updateWechatPhone(userId: number, phone: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { wechatPhone: phone },
    });
  }

  /**
   * 将微信 openid 绑定到已有的手机号账号（账号合并）
   *
   * 场景：用户先通过手机号注册，后续首次微信登录时携带了真实手机号 → 自动合并为同一账号。
   * 合并后用户可以用手机号或微信任意一种方式登录，操作同一份数据。
   */
  async bindWechatToUser(
    userId: number,
    params: {
      openid: string;
      unionid?: string;
      nickname?: string;
      avatar?: string;
      phone?: string;
    },
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        wechatOpenid: params.openid,
        ...(params.unionid != null && { wechatUnionid: params.unionid }),
        ...(params.nickname != null && { wechatNickname: params.nickname }),
        ...(params.avatar != null && { wechatAvatar: params.avatar }),
        ...(params.phone != null && { wechatPhone: params.phone }),
      },
    });
  }

  async findProfileUserOrThrow(userId: number): Promise<ProfileUserRecord> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        realName: true,
        idNumber: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return user;
  }

  async updateAvatar(userId: number, avatar: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatar,
      },
    });
  }

  async updateName(userId: number, name: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        name,
      },
    });
  }

  async verifyRealName(
    userId: number,
    realName: string,
    idNumber: string,
  ): Promise<void> {
    const existingVerifiedUser = await this.prisma.user.findFirst({
      where: {
        idNumber,
        id: { not: userId },
      },
      select: { id: true },
    });

    if (existingVerifiedUser) {
      throw new ConflictException('该身份证号码已完成实名认证');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        realName,
        idNumber,
      },
    });
  }

  async syncStaffMemberships(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    await this.prisma.staff.updateMany({
      where: {
        userId: null,
        OR: [{ email: identifiers.email }, { phone: identifiers.phone }],
      },
      data: {
        userId,
      },
    });
  }

  private async findProfitUserByLoginEmails(
    emails: string[],
  ): Promise<PhoneUserRecord | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        email: { in: emails },
        isActive: true,
        userId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        phone: true,
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
    });

    if (staff?.user && staff.phone) {
      return {
        ...staff.user,
        phone: staff.phone,
        accountScope: 'purely_profit',
      };
    }

    const user = await this.prisma.user.findFirst({
      where: { email: { in: emails } },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    if (!user) {
      return null;
    }

    const relatedStaff = await this.prisma.staff.findFirst({
      where: {
        userId: user.id,
        isActive: true,
        phone: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { phone: true },
    });

    if (!relatedStaff?.phone) {
      return null;
    }

    return {
      ...user,
      phone: relatedStaff.phone,
      accountScope: 'purely_profit',
    };
  }

  private async findDeveloperUserByPhone(
    phone: string,
  ): Promise<PhoneUserRecord | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        phone,
        isActive: true,
        userId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
    });

    if (!staff?.user) {
      return null;
    }

    return {
      ...staff.user,
      phone,
      accountScope: 'developer',
    };
  }
}
