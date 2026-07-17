import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import type { AuthProductScope, PhoneUserRecord } from './auth-account.types';
import type { ProfileUserRecord } from './auth-profile.types';
import {
  buildClubWechatMemberPhone,
  buildPhoneLoginEmails,
  resolveLoginPhone,
} from './auth.utils';
import { AuthProfitAccountLookupService } from './auth-profit-account-lookup.service';

/**
 * 多产品线共享的账号查找服务。
 * profit 专属查找（子账号 loginAccount、loginEmails、开发者手机号）
 * 委托 AuthProfitAccountLookupService。
 */
@Injectable()
export class AuthAccountLookupService {
  private readonly adminLoginAlias: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly profitLookup: AuthProfitAccountLookupService,
    configService: ConfigService,
  ) {
    this.adminLoginAlias =
      configService.get<string>('auth.adminLoginAlias') ?? 'admin';
  }

  async findUserByLoginAccount(
    account: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    const loginPhone = resolveLoginPhone(
      account,
      this.adminLoginAlias,
      this.profitLookup.getAdminLoginPhone(),
    );
    if (loginPhone) {
      return this.findUserByPhone(loginPhone, productScope);
    }

    if (productScope !== 'purely_profit') {
      return null;
    }

    // 直接通过 loginAccount 字段查找，无需解析 email 格式
    return this.profitLookup.findProfitUserByCustomAccount(account);
  }

  async findUserByEmail(
    email: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    if (productScope !== 'purely_profit') {
      return null;
    }

    return this.profitLookup.findProfitUserByLoginEmails([email]);
  }

  async findUserByPhone(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    if (phone === this.profitLookup.getAdminLoginPhone()) {
      const developer = await this.profitLookup.findDeveloperUserByPhone(phone);
      if (developer) {
        return developer;
      }
    }

    if (productScope === 'purely_profit') {
      // 先查全部同手机号候选，用于检测跨门店重复
      const staffCandidates = await this.prisma.staff.findMany({
        where: {
          phone,
          isActive: true,
          userId: { not: null },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          userId: true,
          user: {
            select: {
              id: true,
              email: true,
              password: true,
            },
          },
        },
      });

      this.profitLookup.assertNoCrossTenantConflict(
        staffCandidates,
        'findUserByPhone',
        'phone',
        phone,
      );

      const staff = staffCandidates[0];
      if (staff?.user) {
        return {
          ...staff.user,
          phone,
          accountScope: 'purely_profit',
          staffId: staff.id,
        };
      }
    }

    if (productScope === 'purely_club') {
      return this.findClubUserByPhone(phone);
    }

    return this.findPulseUserByPhone(phone, productScope);
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
   * 跨产品线手机号检查：当用户尝试在一个产品线注册时，
   * 检查同一手机号是否已在另一个产品线注册。
   *
   * 例如：purelyProfit 注册时检查是否已有 purelyClub 账号，反之亦然。
   * 若存在则抛出异常，防止同一手机号在多个产品线重复注册。
   */
  async assertPhoneNotRegisteredInOtherScope(
    phone: string,
    currentScope: AuthProductScope,
  ): Promise<void> {
    const otherScope: AuthProductScope =
      currentScope === 'purely_profit' ? 'purely_club' : 'purely_profit';

    const otherEmails = buildPhoneLoginEmails(otherScope, phone);

    const existingUser = await this.prisma.user.findFirst({
      where: { email: { in: otherEmails } },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException(
        `该手机号已在${otherScope === 'purely_profit' ? '商家端' : '个人端'}注册，请使用其他手机号`,
      );
    }
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

  /**
   * 通过 wechatPhone 查找用户（用于安全检查：写入前判断手机号是否已被其他用户绑定）
   */
  async findUserByWechatPhone(
    phone: string,
  ): Promise<{ id: number; email: string } | null> {
    return this.prisma.user.findFirst({
      where: { wechatPhone: phone },
      select: { id: true, email: true },
    });
  }

  // ─── Private helpers ───

  /**
   * purely_club 手机号查找：
   * 优先通过 email 精确查找，再回退到 wechatPhone。
   * email 与 wechatPhone 均有唯一约束，但 email 查找更精确，
   * 可避免 wechatPhone 数据异常时匹配到错误用户。
   */
  private async findClubUserByPhone(
    phone: string,
  ): Promise<PhoneUserRecord | null> {
    const candidateEmails = buildPhoneLoginEmails('purely_club', phone);
    const emailMatchedUser = await this.prisma.user.findFirst({
      where: { email: { in: candidateEmails } },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    if (emailMatchedUser) {
      return {
        ...emailMatchedUser,
        phone,
        accountScope: 'purely_club',
      };
    }

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

    return null;
  }

  /**
   * 非 profit/club 产品线的手机号查找（pulse 等）
   */
  private async findPulseUserByPhone(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
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
}
