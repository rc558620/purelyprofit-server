import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, StaffRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseDevModeAccessService } from '../dev-mode/pulse-dev-mode-access.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import type { PulseTargetStoreSummary } from '../pulse-store-context.types';

@Injectable()
export class PulseGrowthAccessService {
  private readonly pulseDevAccountEmails: Set<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pulseStoreContextService: PulseStoreContextService,
    configService: ConfigService,
  ) {
    this.pulseDevAccountEmails = new Set(
      (configService.get<string[]>('pulse.devAccountEmails') ?? []).map(
        (email) => email.trim().toLowerCase(),
      ),
    );
  }

  async buildPartnerApplicationWhere(
    user: AuthenticatedUser,
  ): Promise<Prisma.StorePartnerApplicationWhereInput> {
    if (this.isDeveloper(user)) {
      return {
        store: this.buildAdminStoreExclusionWhere(),
      };
    }

    return {
      storeId: await this.resolveObservedStoreId(
        user,
        '当前未选中目标商家门店，暂无法查看合伙人申请',
      ),
    };
  }

  async buildAdminPayoutWhere(
    user: AuthenticatedUser,
  ): Promise<Prisma.PartnerWithdrawalWhereInput> {
    if (this.isDeveloper(user)) {
      return {
        store: this.buildAdminStoreExclusionWhere(),
      };
    }

    return {
      storeId: await this.resolveObservedStoreId(
        user,
        '当前未选中目标商家门店，暂无法查看打款管理',
      ),
    };
  }

  async buildAdminStoreWhere(
    user: AuthenticatedUser,
    options?: { notFoundMessage?: string },
  ): Promise<Prisma.StoreWhereInput> {
    if (this.isDeveloper(user)) {
      return this.buildAdminStoreExclusionWhere();
    }

    return {
      id: await this.resolveObservedStoreId(
        user,
        options?.notFoundMessage ??
          '当前未选中目标商家门店，暂无法查看平台数据',
      ),
    };
  }

  async assertCanAccessAdminStore(
    user: AuthenticatedUser,
    storeId: number,
    notFoundMessage: string,
  ): Promise<void> {
    if (await this.canAccessAdminStore(user, storeId)) {
      return;
    }

    throw new NotFoundException(notFoundMessage);
  }

  /**
   * 将 Pulse 开发者身份映射为目标门店的 owner 作用域用户。
   *
   * ⚠️ 此方法仅用于 Pulse 管理端代目标门店执行操作（如审批合伙人申请）。
   * 当用户无 currentMembership 时，以 owner 全权限身份代理，这是 Pulse 开发者
   * 观察态的设计意图。非开发者用户调用此方法将在代理前被上游守卫拒绝。
   */
  buildScopedUser(user: AuthenticatedUser, storeId: number): AuthenticatedUser {
    const membership = user.currentMembership ?? {
      staffId: 0,
      storeId,
      role: StaffRole.OWNER,
      // Pulse 开发者代理目标门店操作时需要 owner 全权限
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    };

    return {
      ...user,
      currentMembership: {
        ...membership,
        storeId,
      },
    };
  }

  resolveTargetStoreForGrowth(
    user: AuthenticatedUser,
    options?: { notFoundMessage?: string },
  ): Promise<PulseTargetStoreSummary> {
    return this.pulseStoreContextService.resolveTargetStoreOrThrow(user, {
      notFoundMessage:
        options?.notFoundMessage ??
        '当前未选中目标商家门店，暂无法使用增长中心',
    });
  }

  private async resolveObservedStoreId(
    user: AuthenticatedUser,
    notFoundMessage: string,
  ): Promise<number> {
    if (user.currentMembership?.storeId) {
      return user.currentMembership.storeId;
    }

    const store = await this.resolveTargetStoreForGrowth(user, {
      notFoundMessage,
    });
    return store.id;
  }

  private async canAccessAdminStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<boolean> {
    if (this.isDeveloper(user)) {
      return !(await this.isExcludedAdminStore(storeId));
    }

    if (user.currentMembership?.storeId === storeId) {
      return true;
    }

    const resolvedStore =
      await this.pulseStoreContextService.resolveTargetStore(user);
    return resolvedStore.store?.id === storeId;
  }

  private isDeveloper(user: AuthenticatedUser): boolean {
    return PulseDevModeAccessService.isDeveloper(user);
  }

  /** 返回 developer 排除邮箱的指纹，用于缓存 key 区分不同配置 */
  getDevEmailsFingerprint(): string {
    if (this.pulseDevAccountEmails.size === 0) {
      return 'empty';
    }

    return `dev${this.pulseDevAccountEmails.size}`;
  }

  private buildAdminStoreExclusionWhere(): Prisma.StoreWhereInput {
    const excludedEmails = Array.from(this.pulseDevAccountEmails);
    if (excludedEmails.length === 0) {
      // pulse.devAccountEmails 未配置时，developer 模式下不应返回任何商家数据
      return { id: { lt: 0 } };
    }

    return {
      owner: {
        email: {
          notIn: excludedEmails,
        },
      },
    };
  }

  private async isExcludedAdminStore(storeId: number): Promise<boolean> {
    if (this.pulseDevAccountEmails.size === 0) {
      return false;
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        owner: {
          select: {
            email: true,
          },
        },
      },
    });

    return store
      ? this.pulseDevAccountEmails.has(store.owner.email.trim().toLowerCase())
      : false;
  }
}
