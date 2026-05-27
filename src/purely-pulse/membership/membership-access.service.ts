import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type StaffRole } from '@prisma/client';
import { AUTH_TOKEN_VERSION_KEY_PREFIX } from '../../purely-profit/auth/auth.constants';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import type { PulseTargetStoreSummary } from '../pulse-store-context.types';
import { PULSE_MEMBERSHIP_BAN_REASON_KEY_PREFIX } from './membership.constants';

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
    return user.isPulseDeveloper === true || user.pulseMode === 'developer';
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

  async canAccessAdminMember(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<boolean> {
    if (this.isDeveloper(user)) {
      return !(await this.isExcludedAdminStore(memberId));
    }

    if (user.currentMembership?.storeId === memberId) {
      return true;
    }

    const resolvedStore =
      await this.pulseStoreContextService.resolveTargetStore(user);
    return resolvedStore.store?.id === memberId;
  }

  async assertAdminMemberMutationAccess(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<void> {
    if (!this.isDeveloper(user)) {
      throw new ForbiddenException('仅开发者可执行 Pulse 会员管理修改操作');
    }

    const canAccess = await this.canAccessAdminMember(user, memberId);
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

  async writeAdminMemberBanReason(
    storeId: number,
    reason: string,
  ): Promise<void> {
    await this.redisService.set(
      this.getAdminMemberBanReasonKey(storeId),
      reason,
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

    await Promise.all(
      Array.from(userIds).map((userId) => this.bumpTokenVersion(userId)),
    );
  }

  buildScopedUser(user: AuthenticatedUser, storeId: number): AuthenticatedUser {
    const membership = user.currentMembership ?? {
      staffId: 0,
      storeId,
      role: 'owner' as StaffRole,
      permissions: ['*'],
      isActive: true,
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
    await this.redisService.set(key, String(next));
  }

  private getAdminMemberBanReasonKey(storeId: number): string {
    return `${PULSE_MEMBERSHIP_BAN_REASON_KEY_PREFIX}${storeId}:ban-reason`;
  }
}
