import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { toOptionalMediaText } from '../../commerce/commerce.utils';
import type {
  PulseSessionBootstrapResponseDto,
  PulseSessionMembershipDto,
  PulseSessionStoreDto,
  PulseSessionUserDto,
  PulseSwitchCurrentStoreResponseDto,
} from './dto/session-bootstrap.dto';

// ──────────────────────────────────────────────
// 本地内部类型定义
// ──────────────────────────────────────────────

interface UserProfileRow {
  id: number;
  name: string | null;
  avatar: string | null;
  realName: string | null;
  idNumber: string | null;
}

interface StoreRow {
  id: number;
  name: string;
  address: string | null;
}

interface MembershipProfileRow {
  currentPlanId: string | null;
  planName: string | null;
  expiresAt: Date | null;
}

const DAY_MS = 86_400_000;

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────
  // GET /pulse/session/bootstrap
  // ──────────────────────────────────────────────

  async bootstrap(
    user: AuthenticatedUser,
  ): Promise<PulseSessionBootstrapResponseDto> {
    const [profileUser, store] = await Promise.all([
      this.findProfileUserOrThrow(user.id),
      this.findOwnerStore(user.id),
    ]);

    const [membership, unreadNotificationCount] = await Promise.all([
      store ? this.findMembershipSummary(store.id) : Promise.resolve(null),
      store ? this.countUnreadNotifications(store.id) : Promise.resolve(0),
    ]);

    return {
      user: this.buildUserDto(profileUser, user.phone),
      store: store ? this.buildStoreDto(store) : null,
      membership: this.buildMembershipDto(membership),
      unreadNotificationCount,
      hasOnboarded: store !== null,
    };
  }

  // ──────────────────────────────────────────────
  // PATCH /pulse/session/current-store
  // ──────────────────────────────────────────────

  async switchCurrentStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<PulseSwitchCurrentStoreResponseDto> {
    // 当前架构一个老板只能有一个门店（User.store 是唯一关系）
    // 这里先做鉴权校验：确保目标门店属于当前用户
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, ownerId: user.id },
      select: { id: true, name: true, address: true },
    });

    if (!store) {
      throw new ForbiddenException('无权切换到该门店，或门店不存在');
    }

    return {
      success: true,
      store: this.buildStoreDto(store),
    };
  }

  // ──────────────────────────────────────────────
  // 私有方法
  // ──────────────────────────────────────────────

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

  private async findOwnerStore(userId: number): Promise<StoreRow | null> {
    const store = await this.prisma.store.findUnique({
      where: { ownerId: userId },
      select: { id: true, name: true, address: true },
    });

    return store ?? null;
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
    // 通知系统基于 Redis 动态计算，此处直接查询现有通知源聚合计数
    // 为避免重复实现 NotificationsService 内复杂逻辑，
    // 先通过查询 Redis 标记来估算未读数：
    // 关键事件通知（库存预警/账款逾期/合伙人提现/员工请假/会员即将到期/营销活动）
    const now = Date.now();
    const upcomingWindowEnd = this.getDayEnd(now + DAY_MS * 7);

    const [
      lowStockCount,
      overdueAccountCount,
      pendingWithdrawalCount,
      upcomingLeaveCount,
      expiringSubscription,
    ] = await Promise.all([
      // Prisma 不支持 stock <= alertThreshold 的字段间比较，直接内存过滤
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

    return products.filter((p) => p.stock <= p.alertThreshold).length;
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

  private buildStoreDto(store: StoreRow): PulseSessionStoreDto {
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

    const now = new Date();
    const expiresAt = profile.expiresAt;
    const isActive = expiresAt ? expiresAt > now : false;
    const remainingDays = this.calcRemainingDays(expiresAt);

    return {
      isActive,
      planId: profile.currentPlanId,
      planName: profile.planName,
      remainingDays,
      expiresAt,
    };
  }

  private calcRemainingDays(expiresAt: Date | null): number {
    if (!expiresAt) {
      return 0;
    }

    const now = Date.now();
    const diffMs = expiresAt.getTime() - now;
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
