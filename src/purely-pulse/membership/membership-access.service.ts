import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, StaffRole } from '@prisma/client';
import { AUTH_TOKEN_VERSION_KEY_PREFIX } from '../../purely-profit/auth/auth.constants';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PulseDevModeAccessService } from '../dev-mode/pulse-dev-mode-access.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import type { PulseTargetStoreSummary } from '../pulse-store-context.types';
import { PULSE_MEMBERSHIP_BAN_REASON_KEY_PREFIX } from './membership.constants';

/** token-version key 的 TTL（秒），7 天后自动清理 */
const TOKEN_VERSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** 封禁原因 key 的 TTL（秒），30 天后自动清理（封禁信息已在数据库持久化） */
const BAN_REASON_TTL_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class PulseMembershipAccessService {
  private readonly pulseDevAccountEmails: Set<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly pulseStoreContextService: PulseStoreContextService,
    configService: ConfigService,
  ) {
    this.pulseDevAccountEmails = new Set(
      (configService.get<string[]>('pulse.devAccountEmails') ?? []).map(
        (email) => email.trim().toLowerCase(),
      ),
    );
  }

  isDeveloper(user: AuthenticatedUser): boolean {
    return PulseDevModeAccessService.isDeveloper(user);
  }

  resolveTargetStoreForMembership(
    user: AuthenticatedUser,
    options?: { notFoundMessage?: string },
  ): Promise<PulseTargetStoreSummary> {
    return this.pulseStoreContextService.resolveTargetStoreOrThrow(user, {
      notFoundMessage:
        options?.notFoundMessage ??
        '当前未选中目标商家门店，暂无法使用订阅中心',
    });
  }

  async resolveAdminMemberStoreIds(user: AuthenticatedUser): Promise<number[]> {
    if (this.isDeveloper(user)) {
      const profiles = await this.prisma.storeMembershipProfile.findMany({
        where: {
          // 免费会员 currentPlanId 为 null，但仍应保留在会员管理列表中。
          store: this.buildAdminStoreExclusionWhere(),
        },
        select: {
          storeId: true,
        },
        orderBy: {
          storeId: 'asc',
        },
      });

      return profiles.map((profile) => profile.storeId);
    }

    if (user.currentMembership?.storeId) {
      return [user.currentMembership.storeId];
    }

    const resolvedStore =
      await this.pulseStoreContextService.resolveTargetStore(user);
    return resolvedStore.store ? [resolvedStore.store.id] : [];
  }

  /**
   * 检查当前用户是否有权限访问指定会员（门店）的管理数据。
   *
   * 在 Pulse 会员管理上下文中，"会员"即"门店"（store），storeId 就是 memberId。
   * 开发者可访问除自身测试门店外的所有门店；普通用户只能访问自己绑定的门店。
   */
  async canAccessAdminMember(
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

  /**
   * 断言当前用户有权限对指定会员（门店）执行管理修改操作。
   *
   * 仅开发者可执行修改操作；非开发者将收到 403 Forbidden。
   */
  async assertAdminMemberMutationAccess(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<void> {
    if (!this.isDeveloper(user)) {
      throw new ForbiddenException('仅开发者可执行 Pulse 会员管理修改操作');
    }

    const canAccess = await this.canAccessAdminMember(user, storeId);
    if (!canAccess) {
      throw new NotFoundException('会员不存在');
    }
  }

  buildAdminStoreExclusionWhere(): Prisma.StoreWhereInput {
    const excludedEmails = Array.from(this.pulseDevAccountEmails);
    if (excludedEmails.length === 0) {
      return {};
    }

    return {
      owner: {
        email: {
          notIn: excludedEmails,
        },
      },
    };
  }

  getAdminMemberBanReason(storeId: number): Promise<string | null> {
    return this.redisService.get(this.getAdminMemberBanReasonKey(storeId));
  }

  async listAdminMemberBanReasons(
    storeIds: number[],
  ): Promise<Map<number, string>> {
    const normalizedStoreIds = Array.from(new Set(storeIds)).filter(
      (storeId) => Number.isInteger(storeId) && storeId > 0,
    );
    if (normalizedStoreIds.length === 0) {
      return new Map();
    }

    const keys = normalizedStoreIds.map((storeId) =>
      this.getAdminMemberBanReasonKey(storeId),
    );
    const banReasons = await this.redisService.getClient().mget(keys);

    return banReasons.reduce<Map<number, string>>((result, reason, index) => {
      if (reason) {
        result.set(normalizedStoreIds[index], reason);
      }
      return result;
    }, new Map());
  }

  async writeAdminMemberBanReason(
    storeId: number,
    reason: string,
  ): Promise<void> {
    await this.redisService.set(
      this.getAdminMemberBanReasonKey(storeId),
      reason,
      BAN_REASON_TTL_SECONDS,
    );
  }

  async clearAdminMemberBanReason(storeId: number): Promise<void> {
    await this.redisService.del(this.getAdminMemberBanReasonKey(storeId));
  }

  async kickAllStoreUsers(storeId: number): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        ownerId: true,
        staffs: {
          where: { isActive: true, userId: { not: null } },
          select: { userId: true },
        },
      },
    });

    if (!store) {
      return;
    }

    const userIds = new Set<number>([store.ownerId]);
    for (const staff of store.staffs) {
      if (staff.userId !== null) {
        userIds.add(staff.userId);
      }
    }

    await this.bumpTokenVersionBatch(Array.from(userIds));
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

  private async bumpTokenVersion(userId: number): Promise<void> {
    const key = `${AUTH_TOKEN_VERSION_KEY_PREFIX}${userId}`;
    const rawVersion = await this.redisService.get(key);
    const current = Number.parseInt(rawVersion ?? '0', 10);
    const next = Number.isNaN(current) ? 1 : current + 1;
    await this.redisService.set(key, String(next), TOKEN_VERSION_TTL_SECONDS);
  }

  /**
   * 批量 bump token version，用 Redis Pipeline 替代 N 次独立 GET+SET。
   * 先 MGET 批量读取所有当前版本，计算 next 后用 Pipeline 批量 SET。
   */
  private async bumpTokenVersionBatch(userIds: number[]): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const keys = userIds.map((id) => `${AUTH_TOKEN_VERSION_KEY_PREFIX}${id}`);

    // 一次 MGET 读取所有当前版本
    const rawVersions = await this.redisService.mgetJson<string>(keys);

    // 用 Pipeline 批量 SET 新版本
    const client = this.redisService.getClient();
    const pipeline = client.pipeline();
    for (let i = 0; i < userIds.length; i++) {
      const rawVersion = rawVersions[i];
      // mgetJson 会尝试 JSON.parse，纯数字字符串 parse 后还是 string
      const rawStr = rawVersion !== null ? String(rawVersion) : null;
      const current = Number.parseInt(rawStr ?? '0', 10);
      const next = Number.isNaN(current) ? 1 : current + 1;
      pipeline.set(keys[i], String(next), 'EX', TOKEN_VERSION_TTL_SECONDS);
    }
    await pipeline.exec();
  }

  private getAdminMemberBanReasonKey(storeId: number): string {
    return `${PULSE_MEMBERSHIP_BAN_REASON_KEY_PREFIX}${storeId}:ban-reason`;
  }
}
