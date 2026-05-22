import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { toOptionalMediaText } from '../../purely-profit/commerce/commerce.utils';
import {
  PulseStoreContextService,
  type PulseTargetStoreSummary,
} from '../pulse-store-context.service';
import type {
  PulseSessionBootstrapResponseDto,
  PulseSessionMembershipDto,
  PulseSessionStoreDto,
  PulseSessionUserDto,
  PulseSwitchCurrentStoreResponseDto,
} from './dto/session-bootstrap.dto';

interface UserProfileRow {
  id: number;
  name: string | null;
  avatar: string | null;
  realName: string | null;
  idNumber: string | null;
}

interface MembershipProfileRow {
  currentPlanId: string | null;
  planName: string | null;
  expiresAt: Date | null;
}

const DAY_MS = 86_400_000;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pulseStoreContextService: PulseStoreContextService,
  ) {}

  async bootstrap(
    user: AuthenticatedUser,
  ): Promise<PulseSessionBootstrapResponseDto> {
    const profileUser = await this.findProfileUserOrThrow(user.id);
    const resolvedStore = await this.pulseStoreContextService.resolveTargetStore(user);
    const hasSelectedStore = resolvedStore.store !== null;

    const [membership, unreadNotificationCount] = await Promise.all([
      resolvedStore.store
        ? this.findMembershipSummary(resolvedStore.store.id)
        : Promise.resolve(null),
      resolvedStore.store
        ? this.countUnreadNotifications(resolvedStore.store.id)
        : Promise.resolve(0),
    ]);

    return {
      mode: user.pulseMode ?? 'normal',
      user: this.buildUserDto(profileUser, user.phone),
      store: resolvedStore.store ? this.buildStoreDto(resolvedStore.store) : null,
      membership: this.buildMembershipDto(membership),
      unreadNotificationCount,
      targetStoreSelected: hasSelectedStore,
      hasOnboarded: hasSelectedStore,
    };
  }

  async switchCurrentStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<PulseSwitchCurrentStoreResponseDto> {
    const store = await this.pulseStoreContextService.switchTargetStore(user, storeId);

    return {
      success: true,
      store: this.buildStoreDto(store),
    };
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

  private async countUnreadNotifications(storeId: number): Promise<number> {
    const now = Date.now();
    const upcomingWindowEnd = this.getDayEnd(now + DAY_MS * 7);

    const [
      lowStockCount,
      overdueAccountCount,
      pendingWithdrawalCount,
      upcomingLeaveCount,
      expiringSubscription,
    ] = await Promise.all([
      this.countLowStockProducts(storeId),
      this.prisma.financeAccountRecord.count({
        where: { storeId, status: 'overdue' },
      }),
      this.prisma.partnerWithdrawal.count({
        where: { storeId, status: 'pending' },
      }),
      this.prisma.employeeLeave.count({
        where: {
          storeId,
          startDate: {
            gte: new Date(now),
            lte: new Date(upcomingWindowEnd),
          },
        },
      }),
      this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: { expiresAt: true },
      }),
    ]);

    let subscriptionAlert = 0;
    if (
      expiringSubscription?.expiresAt &&
      expiringSubscription.expiresAt.getTime() >= now &&
      expiringSubscription.expiresAt.getTime() <= upcomingWindowEnd
    ) {
      subscriptionAlert = 1;
    }

    return (
      lowStockCount +
      overdueAccountCount +
      pendingWithdrawalCount +
      upcomingLeaveCount +
      subscriptionAlert
    );
  }

  private async countLowStockProducts(storeId: number): Promise<number> {
    const products = await this.prisma.product.findMany({
      where: { storeId, isActive: true },
      select: { stock: true, alertThreshold: true },
    });

    return products.filter((product) => product.stock <= product.alertThreshold)
      .length;
  }

  private buildUserDto(
    user: UserProfileRow,
    phone: string,
  ): PulseSessionUserDto {
    return {
      id: user.id,
      phone,
      name: user.name,
      avatar: toOptionalMediaText(user.avatar) ?? '',
      verified: Boolean(user.realName && user.idNumber),
    };
  }

  private buildStoreDto(store: PulseTargetStoreSummary): PulseSessionStoreDto {
    return {
      id: store.id,
      name: store.name,
      address: store.address,
    };
  }

  private buildMembershipDto(
    profile: MembershipProfileRow | null,
  ): PulseSessionMembershipDto {
    if (!profile || !profile.currentPlanId) {
      return {
        isActive: false,
        planId: null,
        planName: null,
        remainingDays: 0,
        expiresAt: null,
      };
    }

    const expiresAt = profile.expiresAt;
    const isActive = expiresAt ? expiresAt > new Date() : false;

    return {
      isActive,
      planId: profile.currentPlanId,
      planName: profile.planName,
      remainingDays: this.calcRemainingDays(expiresAt),
      expiresAt,
    };
  }

  private calcRemainingDays(expiresAt: Date | null): number {
    if (!expiresAt) {
      return 0;
    }

    const diffMs = expiresAt.getTime() - Date.now();
    if (diffMs <= 0) {
      return 0;
    }

    return Math.ceil(diffMs / DAY_MS);
  }

  private getDayEnd(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }
}
