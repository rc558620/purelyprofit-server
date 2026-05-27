import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPulseSessionBootstrapCacheKey } from '../../redis/cache-keys';
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
    const profileUser = await this.findProfileUserOrThrow(user.id);
    const resolvedStore =
      await this.pulseStoreContextService.resolveTargetStore(user);
    const targetStore = resolvedStore.store;
    const hasSelectedStore = targetStore !== null;
    const cacheKey = buildPulseSessionBootstrapCacheKey(
      user.id,
      user.pulseMode ?? 'normal',
      targetStore?.id ?? null,
    );
    const cachedResponse =
      await this.redisService.getJson<PulseSessionBootstrapResponseDto>(
        cacheKey,
      );
    if (cachedResponse !== null) {
      return cachedResponse;
    }

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

    const response: PulseSessionBootstrapResponseDto = {
      mode: user.pulseMode ?? 'normal',
      user: buildUserDto(profileUser, user.phone),
      store: targetStore ? buildStoreDto(targetStore) : null,
      membership: buildMembershipDto(membership),
      unreadNotificationCount,
      targetStoreSelected: hasSelectedStore,
      hasOnboarded: hasSelectedStore,
    };

    await this.redisService.setJson(
      cacheKey,
      response,
      SESSION_BOOTSTRAP_CACHE_TTL_SECONDS,
    );

    return response;
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
        orders: {
          where: { status: 'paid' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { planName: true },
        },
      },
    });

    if (!profile) {
      return null;
    }

    return {
      currentPlanId: profile.currentPlanId ?? null,
      planName: profile.orders[0]?.planName ?? null,
      expiresAt: profile.expiresAt,
    };
  }
}
