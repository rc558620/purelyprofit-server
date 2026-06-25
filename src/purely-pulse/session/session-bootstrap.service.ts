import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import { buildPulseSessionBootstrapCacheKey } from '../pulse.cache-keys';
import { RedisService } from '../../redis/redis.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import type { PulseSessionBootstrapResponseDto } from './dto/session-bootstrap.dto';
import { SessionNotificationService } from './session-notification.service';
import type { MembershipProfileRow, UserProfileRow } from './session.types';
import {
  buildMembershipDto,
  buildStoreDto,
  buildUserDto,
} from './session.utils';

const SESSION_BOOTSTRAP_CACHE_TTL_SECONDS = 15;
const SESSION_BOOTSTRAP_REFRESH_AFTER_MS = 5_000;

@Injectable()
export class SessionBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly pulseStoreContextService: PulseStoreContextService,
    private readonly sessionNotificationService: SessionNotificationService,
  ) {}

  async bootstrap(
    user: AuthenticatedUser,
  ): Promise<PulseSessionBootstrapResponseDto> {
    const resolvedStore =
      await this.pulseStoreContextService.resolveTargetStore(user);
    const targetStore = resolvedStore.store;
    const hasSelectedStore = targetStore !== null;
    const cacheKey = buildPulseSessionBootstrapCacheKey(
      user.id,
      user.pulseMode ?? 'normal',
      targetStore?.id ?? null,
    );

    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SESSION_BOOTSTRAP_CACHE_TTL_SECONDS,
      refreshAfterMs: SESSION_BOOTSTRAP_REFRESH_AFTER_MS,
      loadValue: async () => {
        const profileUser = await this.findProfileUserOrThrow(user.id);
        const [membership, unreadNotificationCount] = await Promise.all([
          targetStore
            ? this.findMembershipSummary(targetStore.id)
            : Promise.resolve(null),
          targetStore
            ? this.sessionNotificationService.countUnreadNotifications(
                targetStore.id,
              )
            : Promise.resolve(0),
        ]);

        return {
          mode: user.pulseMode ?? 'normal',
          user: buildUserDto(profileUser, user.phone),
          store: targetStore ? buildStoreDto(targetStore) : null,
          membership: buildMembershipDto(membership),
          unreadNotificationCount,
          targetStoreSelected: hasSelectedStore,
          hasOnboarded: hasSelectedStore,
        } satisfies PulseSessionBootstrapResponseDto;
      },
    });
  }

  private async findProfileUserOrThrow(
    userId: number,
  ): Promise<UserProfileRow> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        avatar: true,
        realName: true,
        idNumber: true,
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return user;
  }

  private async findMembershipSummary(
    storeId: number,
  ): Promise<MembershipProfileRow | null> {
    const profile = await this.prisma.storeMembershipProfile.findUnique({
      where: { storeId },
      select: {
        currentPlanId: true,
        expiresAt: true,
      },
    });

    if (!profile) {
      return null;
    }

    // 根据 currentPlanId 查找对应套餐的最近一笔已支付订单，确保 planName 与 currentPlanId 一致
    let planName: string | null = null;
    if (profile.currentPlanId) {
      const matchingOrder = await this.prisma.storeMembershipOrder.findFirst({
        where: {
          storeId,
          status: 'paid',
          planId: profile.currentPlanId,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { planName: true },
      });
      planName = matchingOrder?.planName ?? null;
    }

    return {
      currentPlanId: profile.currentPlanId ?? null,
      planName,
      expiresAt: profile.expiresAt,
    };
  }
}
