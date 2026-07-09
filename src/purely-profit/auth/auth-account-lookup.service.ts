import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ConfigService } from '@nestjs/config';
import type {
  AccountIdentifiers,
  AuthProductScope,
  PhoneUserRecord,
} from './auth-account.types';
import type { ProfileUserRecord } from './auth-profile.types';
import {
  buildClubWechatMemberPhone,
  buildPhoneLoginEmails,
  buildUserCacheKey,
  resolveLoginPhone,
} from './auth.utils';

@Injectable()
export class AuthAccountLookupService {
  private readonly logger = new Logger(AuthAccountLookupService.name);
  private readonly adminLoginAlias: string;
  private readonly adminLoginPhone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    configService: ConfigService,
  ) {
    this.adminLoginAlias = configService.get<string>('auth.adminLoginAlias') ?? 'admin';
    this.adminLoginPhone = configService.get<string>('auth.adminLoginPhone') ?? '13619654020';
  }

  async findUserByLoginAccount(
    account: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    const loginPhone = resolveLoginPhone(account, this.adminLoginAlias, this.adminLoginPhone);
    if (loginPhone) {
      return this.findUserByPhone(loginPhone, productScope);
    }

    if (productScope !== 'purely_profit') {
      return null;
    }

    // 直接通过 loginAccount 字段查找，无需解析 email 格式
    return this.findProfitUserByCustomAccount(account);
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
    if (phone === this.adminLoginPhone) {
      const developer = await this.findDeveloperUserByPhone(phone);
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

      if (staffCandidates.length > 1) {
        const uniqueUserIds = new Set(staffCandidates.map((s) => s.userId));
        if (uniqueUserIds.size > 1) {
          this.logger.warn(
            `[findUserByPhone] phone=${phone} matched ${staffCandidates.length} staff across ${uniqueUserIds.size} different users, denying login to prevent cross-tenant access`,
          );
          throw new ConflictException(
            '该手机号关联了多个账号，请联系管理员处理后重试',
          );
        }
      }

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
      // 优先通过 email 精确查找手机号注册的 club 账号，
      // 再回退到 wechatPhone 查找微信授权手机号绑定的账号。
      // 原因：email 与 wechatPhone 均有唯一约束，但 email 查找更精确，
      // 可避免 wechatPhone 数据异常时匹配到错误用户。
      const candidateEmails = buildPhoneLoginEmails(productScope, phone);
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
    await this.invalidateUserCache(userId);
  }

  /**
   * 通过 wechatPhone 查找用户（用于安全检查：写入前判断手机号是否已被其他用户绑定）
   */
  async findUserByWechatPhone(
    phone: string,
  ): Promise<{ id: number; email: string } | null> {
    const user = await this.prisma.user.findFirst({
      where: { wechatPhone: phone },
      select: {
        id: true,
        email: true,
      },
    });

    return user;
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
    await this.invalidateUserCache(userId);
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
    await this.invalidateUserCache(userId);
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
    await this.invalidateUserCache(userId);

    // 同步头像到关联的营销顾客记录（best-effort）
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { wechatPhone: true, email: true },
    });

    // 收集所有可能的手机号匹配条件
    const phoneConditions: string[] = [];
    if (user?.wechatPhone) phoneConditions.push(user.wechatPhone);

    // 从 email 中提取手机号（club_phone_XXX@... 或 phone_XXX@... 格式）
    if (user?.email) {
      const clubMatch = user.email.match(/^club_phone_(\d+)@/);
      const legacyMatch = user.email.match(/^phone_(\d+)@/);
      if (clubMatch?.[1]) phoneConditions.push(clubMatch[1]);
      if (legacyMatch?.[1]) phoneConditions.push(legacyMatch[1]);
    }

    if (phoneConditions.length > 0) {
      await this.prisma.marketingCustomer
        .updateMany({
          where: { phone: { in: phoneConditions } },
          data: { avatar },
        })
        .catch(() => {
          /* best-effort，不影响主流程 */
        });
    }
  }

  async updateName(userId: number, name: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        name,
      },
    });
    await this.invalidateUserCache(userId);

    // 同步更新关联的 Staff 记录名称，
    // 确保交班页面等通过 Staff.name 展示操作员名称时能显示最新昵称。
    const updatedStaffs = await this.prisma.staff.findMany({
      where: { userId },
      select: { id: true },
    });
    if (updatedStaffs.length > 0) {
      const staffIds = updatedStaffs.map((s) => s.id);
      await this.prisma.staff.updateMany({
        where: { id: { in: staffIds } },
        data: { name },
      });

      // 同步更新关联的 Employee 记录名称，
      // 确保交班页面通过 EmployeeShift.employeeName 展示时也能显示最新昵称。
      await this.prisma.employee.updateMany({
        where: { linkedStaffId: { in: staffIds } },
        data: { name },
      });
    }
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

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          realName,
          idNumber,
        },
      });
      await this.invalidateUserCache(userId);
    } catch (error: unknown) {
      // 并发场景下，两个请求同时通过 findFirst 检查后竞争 update，
      // 第二个请求会触发唯一约束 P2002 错误，需要友好转换
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('该身份证号码已完成实名认证');
      }
      throw error;
    }
  }

  async syncStaffMemberships(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    // 仅回填该用户拥有所有权或已存在身份的门店，防止跨门店错误回填
    const legitimateStoreIds = await this.prisma.store
      .findMany({
        where: {
          OR: [
            { ownerId: userId, deletedAt: null },
            { staffs: { some: { userId, isActive: true } } },
          ],
        },
        select: { id: true },
      })
      .then((stores) => stores.map((s) => s.id));

    if (legitimateStoreIds.length === 0) {
      return;
    }

    await this.prisma.staff.updateMany({
      where: {
        userId: null,
        storeId: { in: legitimateStoreIds },
        OR: [{ email: identifiers.email }, { phone: identifiers.phone }],
      },
      data: {
        userId,
      },
    });
  }

  /**
   * 通过 loginAccount 字段直接查找子账号登录用户
   * 替代旧的 email 格式解析方式，更简洁且无格式歧义
   */
  private async findProfitUserByCustomAccount(
    loginAccount: string,
  ): Promise<PhoneUserRecord | null> {
    const normalizedAccount = loginAccount.trim();

    const staffCandidates = await this.prisma.staff.findMany({
      where: {
        loginAccount: normalizedAccount,
        isActive: true,
        userId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        phone: true,
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
      take: 2,
    });

    if (staffCandidates.length > 1) {
      const uniqueUserIds = new Set(staffCandidates.map((s) => s.userId));
      if (uniqueUserIds.size > 1) {
        this.logger.warn(
          `[findProfitUserByCustomAccount] loginAccount=${normalizedAccount} matched ${staffCandidates.length} staff across ${uniqueUserIds.size} different users, denying login`,
        );
        throw new ConflictException(
          '该登录账号关联了多个账号，请联系管理员处理后重试',
        );
      }
    }

    const staff = staffCandidates[0];
    if (staff?.user && staff.phone) {
      return {
        ...staff.user,
        phone: staff.phone,
        accountScope: 'purely_profit',
        staffId: staff.id,
      };
    }

    return null;
  }

  private async findProfitUserByLoginEmails(
    emails: string[],
  ): Promise<PhoneUserRecord | null> {
    const staffCandidates = await this.prisma.staff.findMany({
      where: {
        email: { in: emails },
        isActive: true,
        userId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        phone: true,
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
      take: 2,
    });

    if (staffCandidates.length > 1) {
      const uniqueUserIds = new Set(staffCandidates.map((s) => s.userId));
      if (uniqueUserIds.size > 1) {
        this.logger.warn(
          `[findProfitUserByLoginEmails] emails=${emails.join(',')} matched ${staffCandidates.length} staff across ${uniqueUserIds.size} different users, denying login`,
        );
        throw new ConflictException(
          '该登录邮箱关联了多个账号，请联系管理员处理后重试',
        );
      }
    }

    const staff = staffCandidates[0];
    if (staff?.user && staff.phone) {
      return {
        ...staff.user,
        phone: staff.phone,
        accountScope: 'purely_profit',
        staffId: staff.id,
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
      select: { id: true, phone: true },
    });

    if (!relatedStaff?.phone) {
      return null;
    }

    return {
      ...user,
      phone: relatedStaff.phone,
      accountScope: 'purely_profit',
      staffId: relatedStaff.id,
    };
  }

  /**
   * 失效 JWT validate 链路中的 user 缓存，确保下次鉴权时读取最新数据。
   * 调用场景：用户资料变更（昵称、头像、实名认证、微信绑定等）。
   */
  private async invalidateUserCache(userId: number): Promise<void> {
    try {
      await this.redisService.del(buildUserCacheKey(userId));
    } catch (error: unknown) {
      // 缓存失效失败不影响主流程，TTL 自然过期即可兜底
      this.logger.warn(
        `[AuthAccountLookupService] 失效用户 ${userId} 缓存失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async findDeveloperUserByPhone(
    phone: string,
  ): Promise<PhoneUserRecord | null> {
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

    if (staffCandidates.length > 1) {
      const uniqueUserIds = new Set(staffCandidates.map((s) => s.userId));
      if (uniqueUserIds.size > 1) {
        this.logger.warn(
          `[findDeveloperUserByPhone] phone=${phone} matched ${staffCandidates.length} staff across ${uniqueUserIds.size} different users, denying login to prevent cross-tenant access`,
        );
        throw new ConflictException(
          '该手机号关联了多个账号，请联系管理员处理后重试',
        );
      }
    }

    const staff = staffCandidates[0];
    if (!staff?.user) {
      return null;
    }

    return {
      ...staff.user,
      phone,
      accountScope: 'developer',
      staffId: staff.id,
    };
  }
}
