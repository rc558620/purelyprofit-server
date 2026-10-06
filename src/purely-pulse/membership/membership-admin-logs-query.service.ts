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
} from './membership-admin-member.builder';
import {
  encodeAdminMemberLogsCursor,
  resolveAdminMemberLogsCursorPagination,
} from './membership-admin-query.helper';

type AdminMemberLogsCursor = { createdAt: Date; id: number };

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
          where: this.buildPointsLogsWhere(query, storeIds, cursorPagination.cursor),
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
      async (storeIds) => this.countPointsLogsStats(this.buildPointsLogsWhere(query, storeIds, null)),
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
          where: this.buildBeanLogsWhere(query, storeIds, cursorPagination.cursor),
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
      async (storeIds) => this.countBeanLogsStats(this.buildBeanLogsWhere(query, storeIds, null)),
    );

    return {
      items: result.items.map(buildPulseAdminBeanLogItem),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      stats: result.stats ?? EMPTY_BEAN_LOGS_STATS,
    };
  }

  /**
   * 构造纯利豆流水的查询条件。
   *
   * Tab 与关键词过滤和统计查询共用同一份条件，避免出现「列表被筛过、统计没筛过」的口径错位。
   *
   * 各条件统一走 AND 组合：Tab（尤其是「消耗/提现」）与关键词都会用到 OR，
   * 平铺展开会让后一个 OR 覆盖前一个，条件被静默丢弃。
   */
  private buildBeanLogsWhere(
    query: GetPulseAdminMemberLogsQueryDto,
    storeIds: number[],
    cursor: AdminMemberLogsCursor | undefined | null,
  ): Prisma.StorePartnerBeanLogWhereInput {
    const andConditions: Prisma.StorePartnerBeanLogWhereInput[] = [];
    const tabWhere = buildBeanTabWhere(query.beanTab);

    if (Object.keys(tabWhere).length > 0) {
      andConditions.push(tabWhere);
    }

    if (query.keyword) {
      andConditions.push({ OR: buildBeanKeywordConditions(query.keyword) });
    }

    if (cursor) {
      andConditions.push(buildCursorWhere(cursor));
    }

    return {
      storeId: { in: storeIds },
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
    };
  }

  /**
   * 构造积分流水的查询条件：与纯利豆同构，Tab / 关键词 / 游标统一走 AND 组合。
   *
   * 平铺展开会让后一个 OR 覆盖前一个（「消耗」Tab 自带 OR、关键词也是 OR），
   * 条件被静默丢弃后前端会看到「筛选没生效」。
   */
  private buildPointsLogsWhere(
    query: GetPulseAdminMemberLogsQueryDto,
    storeIds: number[],
    cursor: AdminMemberLogsCursor | undefined | null,
  ): Prisma.StoreMembershipPointsLogWhereInput {
    const andConditions: Prisma.StoreMembershipPointsLogWhereInput[] = [];
    const tabWhere = buildPointsTabWhere(query.pointsTab);

    if (Object.keys(tabWhere).length > 0) {
      andConditions.push(tabWhere);
    }

    if (query.keyword) {
      andConditions.push({ OR: buildPointsKeywordConditions(query.keyword) });
    }

    if (cursor) {
      andConditions.push(buildCursorWhere(cursor));
    }

    return {
      storeId: { in: storeIds },
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
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

/** 游标条件的结构：积分与纯利豆两张流水表的 where 都能吃下这一段。 */
interface AdminMemberLogsCursorWhere {
  OR: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: number } }>;
}

/** 游标条件：同时间戳时按 id 二次排序，保证翻页不重不漏。 */
function buildCursorWhere(
  cursor: AdminMemberLogsCursor,
): AdminMemberLogsCursorWhere {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * 积分 Tab 语义转换。
 *
 * 边界必须与 `buildPulseAdminPointsLogItem` 的 type 推导逐条对齐：
 * type = source==='expire' ? 'expire' : changeType==='increase' ? 'earn' : 'spend'。
 * 于是「获得」= 非过期来源且 increase，「消耗」= 过期来源或 decrease ——
 * 两个 Tab 都排除管理员调整（管理员调整在 memberPoints 页单独成 Tab）。
 */
function buildPointsTabWhere(
  pointsTab: GetPulseAdminMemberLogsQueryDto['pointsTab'],
): Prisma.StoreMembershipPointsLogWhereInput {
  switch (pointsTab) {
    case 'admin':
      return { source: 'admin_adjust' };
    case 'earn':
      return {
        source: { notIn: ['admin_adjust', 'expire'] },
        changeType: 'increase',
      };
    case 'spend':
      return {
        source: { not: 'admin_adjust' },
        OR: [{ source: 'expire' }, { changeType: 'decrease' }],
      };
    case 'all':
    default:
      return {};
  }
}

/**
 * 积分关键词：流水说明 + 门店 / 会员身份字段，覆盖前端搜索框的三种意图。
 *
 * 必须带上 owner.email：展示手机号 `resolveAdminMemberPhone` 的最后一级兜底是
 * 从占位邮箱 `phone_13619654020@purelyprofit.local` 里解析出手机号，
 * 只搜 contactPhone / wechatPhone 会让这批用户「看得见手机号却搜不到」。
 */
function buildPointsKeywordConditions(
  keyword: string,
): Prisma.StoreMembershipPointsLogWhereInput[] {
  return [
    { description: { contains: keyword } },
    { store: { name: { contains: keyword } } },
    { store: { contactPhone: { contains: keyword } } },
    { store: { owner: { realName: { contains: keyword } } } },
    { store: { owner: { name: { contains: keyword } } } },
    { store: { owner: { wechatPhone: { contains: keyword } } } },
    { store: { owner: { email: { contains: keyword } } } },
  ];
}

/**
 * Tab 语义转换。
 *
 * 「获得」「消耗/提现」两个 Tab 都要排除管理员调整（管理员调整在 partnerBeans 页单独成 Tab）。
 * 边界必须与 `buildPulseAdminBeanLogItem` 的 type 推导完全对齐：
 * type = source==='withdrawal' ? 'withdraw' : changeAmount > 0 ? 'earn' : 'spend'。
 * 也即在「提现恒为 withdraw」的前提下，earn=金额>0、spend=金额<=0 ——
 * 若 earn 用 >=0、spend 用 <0，金额恰好为 0 的流水会在两个 Tab 里都查不到。
 */
function buildBeanTabWhere(
  beanTab: GetPulseAdminMemberLogsQueryDto['beanTab'],
): Prisma.StorePartnerBeanLogWhereInput {
  switch (beanTab) {
    case 'admin':
      return { source: 'admin_adjust' };
    case 'earn':
      return {
        source: { notIn: ['admin_adjust', 'withdrawal'] },
        changeAmount: { gt: 0 },
      };
    case 'spend':
      return {
        source: { not: 'admin_adjust' },
        OR: [{ source: 'withdrawal' }, { changeAmount: { lte: 0 } }],
      };
    case 'all':
    default:
      return {};
  }
}

/**
 * 关键词：流水说明 + 门店 / 合伙人身份字段，覆盖前端搜索框的三种意图。
 *
 * 必须带上 owner.email：展示手机号 `resolveAdminMemberPhone` 的最后一级兜底是
 * 从占位邮箱 `phone_13619654020@purelyprofit.local` 里解析出手机号，
 * 只搜 contactPhone / wechatPhone 会让这批用户「看得见手机号却搜不到」。
 */
function buildBeanKeywordConditions(
  keyword: string,
): Prisma.StorePartnerBeanLogWhereInput[] {
  return [
    { description: { contains: keyword } },
    { store: { name: { contains: keyword } } },
    { store: { contactPhone: { contains: keyword } } },
    { store: { owner: { realName: { contains: keyword } } } },
    { store: { owner: { name: { contains: keyword } } } },
    { store: { owner: { wechatPhone: { contains: keyword } } } },
    { store: { owner: { email: { contains: keyword } } } },
  ];
}
