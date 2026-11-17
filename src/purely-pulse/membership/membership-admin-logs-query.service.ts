import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import type {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberBeanLogsStatsDto,
  PulseAdminMemberPointsLogsResponseDto,
  PulseAdminMemberPointsLogsStatsDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import {
  buildPulseAdminBeanLogItem,
  buildPulseAdminPointsLogItem,
} from './membership-admin-member-logs.builder';
import {
  encodeAdminMemberLogsCursor,
  resolveAdminMemberLogsCursorPagination,
} from './membership-admin-query.helper';
import {
  buildBeanLogsWhere,
  buildPointsLogsWhere,
} from './membership-admin-logs-where.helper';

/** 统计为 null 时的兜底：分页失败也不让概览卡拿到 undefined。 */
const EMPTY_BEAN_LOGS_STATS: PulseAdminMemberBeanLogsStatsDto = {
  totalRecords: 0,
  adminAdjustCount: 0,
  withdrawCount: 0,
  promoRewardCount: 0,
};

const EMPTY_POINTS_LOGS_STATS: PulseAdminMemberPointsLogsStatsDto = {
  totalRecords: 0,
  adminAdjustCount: 0,
  todayChangeCount: 0,
};

@Injectable()
export class PulseMembershipAdminLogsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

  /**
   * 积分流水：Tab、关键词与游标全部下推到数据库。
   *
   * 前端改成游标分页（PullRefreshLoadMore）后每页只有一页数据，
   * 本地过滤 / 本地计数会退化成「只筛已加载的那一页」，因此过滤与统计都必须在这里完成。
   */
  async listAdminPointsLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    const result = await this.listAdminLogs(
      user,
      query,
      async (storeIds, cursorPagination) =>
        this.prisma.storeMembershipPointsLog.findMany({
          where: buildPointsLogsWhere(query, storeIds, cursorPagination.cursor),
          select: {
            id: true,
            storeId: true,
            source: true,
            changeType: true,
            changeAmount: true,
            description: true,
            expireAt: true,
            createdAt: true,
            store: {
              select: {
                name: true,
                contactPhone: true,
                owner: {
                  select: {
                    email: true,
                    name: true,
                    realName: true,
                    avatar: true,
                    wechatPhone: true,
                  },
                },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(cursorPagination.limit !== undefined
            ? { take: cursorPagination.limit + 1 }
            : {}),
        }),
      // 与纯利豆同口径：统计吃「同筛选、不含游标」的完整结果集
      async (storeIds) =>
        this.countPointsLogsStats(buildPointsLogsWhere(query, storeIds, null)),
    );

    return {
      items: result.items.map(buildPulseAdminPointsLogItem),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      stats: result.stats ?? EMPTY_POINTS_LOGS_STATS,
    };
  }

  async listAdminBeanLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberBeanLogsResponseDto> {
    const result = await this.listAdminLogs(
      user,
      query,
      async (storeIds, cursorPagination) =>
        this.prisma.storePartnerBeanLog.findMany({
          where: buildBeanLogsWhere(query, storeIds, cursorPagination.cursor),
          select: {
            id: true,
            storeId: true,
            source: true,
            changeAmount: true,
            description: true,
            relatedPromoRecordId: true,
            relatedUser: true,
            createdAt: true,
            store: {
              select: {
                name: true,
                contactPhone: true,
                owner: {
                  select: {
                    email: true,
                    name: true,
                    realName: true,
                    avatar: true,
                    wechatPhone: true,
                  },
                },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...(cursorPagination.limit !== undefined
            ? { take: cursorPagination.limit + 1 }
            : {}),
        }),
      // 统计必须吃「同筛选、不含游标」的完整结果集：分页后前端只有一页数据，
      // 由前端自己 count 会让概览卡数字随加载量变化（member-list 的 stats 同口径）
      async (storeIds) =>
        this.countBeanLogsStats(buildBeanLogsWhere(query, storeIds, null)),
    );

    return {
      items: result.items.map(buildPulseAdminBeanLogItem),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      stats: result.stats ?? EMPTY_BEAN_LOGS_STATS,
    };
  }

  /**
   * 积分流水统计：总条数 + 管理员调整条数 + 今日变动条数。
   *
   * 「今日」按服务端自然日 00:00 起算，必须在数据库里过滤 —— 前端分页后只有一页，
   * 本地数今日条数只会数到「已加载页里属于今天的那些」。
   */
  private async countPointsLogsStats(
    where: Prisma.StoreMembershipPointsLogWhereInput,
  ): Promise<PulseAdminMemberPointsLogsStatsDto> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [grouped, adminAdjustCount, todayChangeCount] = await Promise.all([
      this.prisma.storeMembershipPointsLog.groupBy({
        by: ['source'],
        where,
        _count: { _all: true },
      }),
      this.prisma.storeMembershipPointsLog.count({
        where: { ...where, source: 'admin_adjust' },
      }),
      this.prisma.storeMembershipPointsLog.count({
        where: { ...where, createdAt: { gte: startOfToday } },
      }),
    ]);

    let totalRecords = 0;
    for (const row of grouped) {
      totalRecords += row._count._all;
    }

    return { totalRecords, adminAdjustCount, todayChangeCount };
  }

  /** 按 source 分组计数：一次查询拿到概览卡需要的四个指标。 */
  private async countBeanLogsStats(
    where: Prisma.StorePartnerBeanLogWhereInput,
  ): Promise<PulseAdminMemberBeanLogsStatsDto> {
    const grouped = await this.prisma.storePartnerBeanLog.groupBy({
      by: ['source'],
      where,
      _count: { _all: true },
    });

    let totalRecords = 0;
    let adminAdjustCount = 0;
    let withdrawCount = 0;
    let promoRewardCount = 0;

    for (const row of grouped) {
      const count = row._count._all;
      totalRecords += count;

      if (row.source === 'admin_adjust') {
        adminAdjustCount = count;
      } else if (row.source === 'withdrawal') {
        withdrawCount = count;
      } else if (row.source === 'promo_reward') {
        promoRewardCount = count;
      }
    }

    return { totalRecords, adminAdjustCount, withdrawCount, promoRewardCount };
  }

  private async listAdminLogs<
    TLogRecord extends { id: number; createdAt: Date },
    TStats,
  >(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
    fetchLogs: (
      storeIds: number[],
      cursorPagination: ReturnType<
        typeof resolveAdminMemberLogsCursorPagination
      >,
    ) => Promise<TLogRecord[]>,
    fetchStats?: (storeIds: number[]) => Promise<TStats>,
  ): Promise<{
    items: TLogRecord[];
    hasMore: boolean;
    nextCursor: string | null;
    stats?: TStats;
  }> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const cursorPagination = resolveAdminMemberLogsCursorPagination(query);
    // 列表与统计互不依赖：并行发起，概览卡不用等列表切片完成
    const [logs, stats] = await Promise.all([
      fetchLogs(storeIds, cursorPagination),
      fetchStats ? fetchStats(storeIds) : Promise.resolve(undefined),
    ]);
    const hasMore =
      cursorPagination.limit !== undefined &&
      logs.length > cursorPagination.limit;
    const visibleLogs = hasMore ? logs.slice(0, cursorPagination.limit) : logs;

    return {
      items: visibleLogs,
      hasMore,
      nextCursor: hasMore
        ? encodeAdminMemberLogsCursor(visibleLogs.at(-1) ?? null)
        : null,
      ...(stats !== undefined ? { stats } : {}),
    };
  }
}
