import { Injectable, Logger } from '@nestjs/common';
import {
  ScanOrderPaymentStatus,
  ScanOrderStatus,
  ScanOrderingSessionStatus,
} from '@prisma/client';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import {
  formatShanghaiDate,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { ScanOrderingDashboardResponse } from './scan-ordering.types';
import { buildCacheRefreshTaskKey } from '../../../redis/cache-keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';

/**
 * 看板读缓存：单次请求要跑 6 条 SQL（含带会话关联的多次 count），命中后降为
 * 一次 Redis GET。订单状态写路径极多，逐个挂失效不现实，因此采用短 TTL +
 * 提前后台刷新把陈旧窗口收敛到数秒；实时变更仍由 WebSocket 推送兜底。
 * TTL 远小于营业日粒度，跨零点最多带出上一日日期数秒。
 */
const DASHBOARD_CACHE_TTL_SECONDS = 15;
const DASHBOARD_CACHE_REFRESH_AFTER_MS = 5_000;

function buildDashboardCacheKey(storeId: number): string {
  return `profit:scan-ordering:dashboard:store:${storeId}`;
}

/** 商家扫码点餐看板查询服务。 */
@Injectable()
export class ScanOrderingDashboardService {
  private readonly logger = new Logger(ScanOrderingDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  async getDashboard(
    user: AuthenticatedUser,
  ): Promise<ScanOrderingDashboardResponse> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看扫码点餐数据',
    );

    const cacheKey = buildDashboardCacheKey(storeId);
    try {
      return await this.refreshableCache.getOrLoadRefreshableJson<ScanOrderingDashboardResponse>(
        {
          cacheKey,
          taskKey: buildCacheRefreshTaskKey(cacheKey),
          ttlSeconds: DASHBOARD_CACHE_TTL_SECONDS,
          refreshAfterMs: DASHBOARD_CACHE_REFRESH_AFTER_MS,
          loadValue: () => this.buildDashboard(storeId),
        },
      );
    } catch (error) {
      // 缓存仅作加速层：Redis 异常时降级为实时查询，看板仍可用
      this.logger.warn(
        `读取扫码点餐看板缓存失败 storeId=${storeId}，回退实时查询: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.buildDashboard(storeId);
    }
  }

  private async buildDashboard(
    storeId: number,
  ): Promise<ScanOrderingDashboardResponse> {
    const startOfDayMs = getShanghaiDayStartMs(Date.now());
    const startOfDay = new Date(startOfDayMs);
    const startOfNextDay = new Date(startOfDayMs + 24 * 60 * 60 * 1_000);
    const paidTodayWhere = {
      storeId,
      paidAt: { gte: startOfDay, lt: startOfNextDay },
    };
    const activeSessionWhere = {
      status: ScanOrderingSessionStatus.active,
      deletedAt: null,
      expiresAt: { gt: new Date() },
    };
    const currentRoundSessionWhere = {
      OR: [
        activeSessionWhere,
        {
          status: ScanOrderingSessionStatus.left,
          table: { is: { sessions: { some: activeSessionWhere } } },
        },
      ],
    };
    const [
      paidRevenue,
      paidOrderCount,
      pendingOrderCount,
      preparingOrderCount,
      refundingOrderCount,
      tableGroups,
    ] = await Promise.all([
      this.prisma.scanOrders.aggregate({
        where: {
          ...paidTodayWhere,
          paymentStatus: {
            in: [ScanOrderPaymentStatus.paid, ScanOrderPaymentStatus.refunding],
          },
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.scanOrders.count({
        where: {
          storeId,
          createdAt: { gte: startOfDay, lt: startOfNextDay },
        },
      }),
      this.prisma.scanOrders.count({
        where: {
          storeId,
          status: ScanOrderStatus.pending_acceptance,
          OR: [
            { session: { is: currentRoundSessionWhere } },
            { manualEntry: true },
          ],
        },
      }),
      this.prisma.scanOrders.count({
        where: {
          storeId,
          status: ScanOrderStatus.preparing,
          OR: [
            { session: { is: currentRoundSessionWhere } },
            { manualEntry: true },
          ],
        },
      }),
      this.prisma.scanOrders.count({
        where: {
          storeId,
          status: ScanOrderStatus.refunding,
          paymentStatus: ScanOrderPaymentStatus.refunding,
          OR: [
            { session: { is: currentRoundSessionWhere } },
            { manualEntry: true },
          ],
        },
      }),
      this.prisma.scanOrderingTable.groupBy({
        by: ['status'],
        where: { storeId, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const tableStatusSummary: ScanOrderingDashboardResponse['tableStatusSummary'] =
      { empty: 0, dining: 0, clearing: 0, disabled: 0 };
    for (const group of tableGroups) {
      tableStatusSummary[group.status] = group._count._all;
    }

    return {
      businessDate: formatShanghaiDate(startOfDayMs),
      paidRevenue: Money.fromDbCents(
        paidRevenue._sum.paidAmount ?? 0,
      ).toOutputYuan(),
      paidOrderCount,
      pendingOrderCount,
      preparingOrderCount,
      refundingOrderCount,
      tableStatusSummary,
    };
  }
}
