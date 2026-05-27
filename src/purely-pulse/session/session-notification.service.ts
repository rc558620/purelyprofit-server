import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPulseSessionNotificationCacheKey } from '../../redis/cache-keys';
import { RedisService } from '../../redis/redis.service';

const DAY_MS = 86_400_000;
const SESSION_NOTIFICATION_CACHE_TTL_SECONDS = 15;

@Injectable()
export class SessionNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async countUnreadNotifications(storeId: number): Promise<number> {
    const cacheKey = buildPulseSessionNotificationCacheKey(storeId);
    const cachedCount = await this.redisService.getJson<number>(cacheKey);
    if (cachedCount !== null) {
      return cachedCount;
    }

    const now = Date.now();
    const upcomingWindowEnd = getDayEnd(now + DAY_MS * 7);

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

    const subscriptionAlert = shouldAlertSubscription(
      expiringSubscription?.expiresAt ?? null,
      now,
      upcomingWindowEnd,
    )
      ? 1
      : 0;

    const unreadCount =
      lowStockCount +
      overdueAccountCount +
      pendingWithdrawalCount +
      upcomingLeaveCount +
      subscriptionAlert;

    await this.redisService.setJson(
      cacheKey,
      unreadCount,
      SESSION_NOTIFICATION_CACHE_TTL_SECONDS,
    );

    return unreadCount;
  }

  private async countLowStockProducts(storeId: number): Promise<number> {
    const products = await this.prisma.product.findMany({
      where: { storeId, isActive: true },
      select: { stock: true, alertThreshold: true },
    });

    return products.filter((product) => product.stock <= product.alertThreshold)
      .length;
  }
}

function shouldAlertSubscription(
  expiresAt: Date | null,
  now: number,
  upcomingWindowEnd: number,
): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = expiresAt.getTime();
  return expiresAtMs >= now && expiresAtMs <= upcomingWindowEnd;
}

function getDayEnd(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}
