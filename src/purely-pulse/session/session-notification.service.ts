import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildDerivedFinanceAccountStatusWhere } from '../../purely-profit/finance/finance-account.query';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import { buildPulseSessionNotificationCacheKey } from '../pulse.cache-keys';
import { RedisService } from '../../redis/redis.service';

const DAY_MS = 86_400_000;
const SESSION_NOTIFICATION_CACHE_TTL_SECONDS = 15;
const SESSION_NOTIFICATION_REFRESH_AFTER_MS = 5_000;

@Injectable()
export class SessionNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async countUnreadNotifications(storeId: number): Promise<number> {
    const cacheKey = buildPulseSessionNotificationCacheKey(storeId);
    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SESSION_NOTIFICATION_CACHE_TTL_SECONDS,
      refreshAfterMs: SESSION_NOTIFICATION_REFRESH_AFTER_MS,
      loadValue: () => this.buildUnreadNotificationsCount(storeId),
    });
  }

  private async buildUnreadNotificationsCount(
    storeId: number,
  ): Promise<number> {
    const now = Date.now();
    const todayStart = getDayStart(now);
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
        where: buildDerivedFinanceAccountStatusWhere({
          storeId,
          status: 'overdue',
          now,
        }),
      }),
      this.prisma.partnerWithdrawal.count({
        where: { storeId, status: 'pending' },
      }),
      this.prisma.employeeLeave.count({
        where: {
          storeId,
          startDate: {
            gte: new Date(todayStart),
            lte: new Date(upcomingWindowEnd),
          },
        },
      }),
      this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: { expiresAt: true },
      }),
    ]);

    return (
      lowStockCount +
      overdueAccountCount +
      pendingWithdrawalCount +
      upcomingLeaveCount +
      (shouldAlertSubscription(
        expiringSubscription?.expiresAt ?? null,
        now,
        upcomingWindowEnd,
      )
        ? 1
        : 0)
    );
  }

  /**
   * 统计低库存商品数量。
   *
   * 执行计划说明：
   * - WHERE store_id = $1 AND is_active = true AND stock <= alert_threshold
   * - 预期走 (store_id, is_active) 复合索引 + 过滤 stock 条件
   * - 若 alert_threshold 选择性差，可考虑 (store_id, is_active, stock) 复合索引
   */
  private async countLowStockProducts(storeId: number): Promise<number> {
    const result = await this.prisma.$queryRaw<
      Array<{ count: bigint | number }>
    >`
      SELECT COUNT(*)::bigint AS count
      FROM products
      WHERE store_id = ${storeId}
        AND is_active = true
        AND deleted_at IS NULL
        AND stock <= alert_threshold
    `;

    const count = result[0]?.count ?? 0;
    return typeof count === 'bigint' ? Number(count) : count;
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

function getDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
