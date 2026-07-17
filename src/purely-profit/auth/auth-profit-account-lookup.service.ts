import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import type { PhoneUserRecord } from './auth-account.types';

/**
 * 承接 purely-profit 专属的账号查找逻辑：
 * - 子账号 loginAccount 查找
 * - loginEmails 查找（含 staff→user 回退）
 * - 开发者手机号查找
 *
 * 多产品线共享的查找能力（findUserByPhone / findUserByWechatOpenid 等）
 * 保留在 AuthAccountLookupService。
 */
@Injectable()
export class AuthProfitAccountLookupService {
  private readonly logger = new Logger(AuthProfitAccountLookupService.name);
  private readonly adminLoginPhone: string;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.adminLoginPhone =
      configService.get<string>('auth.adminLoginPhone') ?? '13619654020';
  }

  /**
   * 通过 loginAccount 字段直接查找子账号登录用户
   * 替代旧的 email 格式解析方式，更简洁且无格式歧义
   */
  async findProfitUserByCustomAccount(
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

    this.assertNoCrossTenantConflict(
      staffCandidates,
      'findProfitUserByCustomAccount',
      'loginAccount',
      normalizedAccount,
    );

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

  async findProfitUserByLoginEmails(
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

    this.assertNoCrossTenantConflict(
      staffCandidates,
      'findProfitUserByLoginEmails',
      'emails',
      emails.join(','),
    );

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

  async findDeveloperUserByPhone(
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

    this.assertNoCrossTenantConflict(
      staffCandidates,
      'findDeveloperUserByPhone',
      'phone',
      phone,
    );

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

  getAdminLoginPhone(): string {
    return this.adminLoginPhone;
  }

  /**
   * 检测 staff 候选列表中是否存在跨租户冲突：
   * 当多个 staff 记录分属不同 user 时，拒绝登录以防止跨门店数据泄露。
   */
  assertNoCrossTenantConflict(
    staffCandidates: Array<{ userId: number | null }>,
    caller: string,
    identifierName: string,
    identifierValue: string,
  ): void {
    if (staffCandidates.length <= 1) return;

    const uniqueUserIds = new Set(staffCandidates.map((s) => s.userId));
    if (uniqueUserIds.size > 1) {
      this.logger.warn(
        `[${caller}] ${identifierName}=${identifierValue} matched ${staffCandidates.length} staff across ${uniqueUserIds.size} different users, denying login to prevent cross-tenant access`,
      );
      // 使用通用消息，避免通过差异化提示泄露该账号在其他门店存在的信息
      throw new ConflictException('账号异常，请联系管理员处理后重试');
    }
  }

  private describeIdentifier(identifierName: string): string {
    const labelMap: Record<string, string> = {
      phone: '手机号',
      loginAccount: '登录账号',
      emails: '登录邮箱',
    };
    return labelMap[identifierName] ?? identifierName;
  }
}
