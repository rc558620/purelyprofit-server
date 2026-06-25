import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';
import type {
  PulseAdminMemberBeanLogsResponseDto,
  PulseAdminMemberPointsLogsResponseDto,
} from './dto/pulse-membership-admin-logs.response.dto';
import type { GetPulseAdminMembersQueryDto } from './dto/pulse-membership-admin-members.request.dto';
import type {
  PulseAdminEmployeeCandidateDto,
  PulseAdminMemberClubLevelBreakdownDto,
  PulseAdminMemberClubStatsDto,
  PulseAdminMemberSalesPeriodSummaryDto,
  PulseAdminMemberSalesStatsDto,
  PulseAdminMembersResponseDto,
  PulseMemberDetailDto,
} from './dto/pulse-membership-admin-members.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminMemberReadService } from './membership-admin-member-read.service';
import { PulseMembershipAdminSubAccountReadService } from './membership-admin-sub-account-read.service';
import {
  buildPulseAdminBeanLogItem,
  buildPulseAdminPointsLogItem,
} from './membership-admin-member.builder';
import {
  encodeAdminMemberLogsCursor,
  resolveAdminMemberLogsCursorPagination,
} from './membership-admin-query.helper';

@Injectable()
export class PulseMembershipAdminQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
    private readonly memberReadService: PulseMembershipAdminMemberReadService,
    private readonly subAccountReadService: PulseMembershipAdminSubAccountReadService,
  ) {}

  async listAdminPointsLogs(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
  ): Promise<PulseAdminMemberPointsLogsResponseDto> {
    const result = await this.listAdminLogs(
      user,
      query,
      async (storeIds, cursorPagination) =>
        this.prisma.storeMembershipPointsLog.findMany({
          where: {
            storeId: { in: storeIds },
            ...(cursorPagination.cursor
              ? {
                  OR: [
                    { createdAt: { lt: cursorPagination.cursor.createdAt } },
                    {
                      createdAt: cursorPagination.cursor.createdAt,
                      id: { lt: cursorPagination.cursor.id },
                    },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            storeId: true,
            source: true,
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
    );

    return {
      items: result.items.map(buildPulseAdminPointsLogItem),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
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
          where: {
            storeId: { in: storeIds },
            ...(cursorPagination.cursor
              ? {
                  OR: [
                    { createdAt: { lt: cursorPagination.cursor.createdAt } },
                    {
                      createdAt: cursorPagination.cursor.createdAt,
                      id: { lt: cursorPagination.cursor.id },
                    },
                  ],
                }
              : {}),
          },
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
    );

    return {
      items: result.items.map(buildPulseAdminBeanLogItem),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
  }

  async listAdminMembers(
    user: AuthenticatedUser,
    query: GetPulseAdminMembersQueryDto,
  ): Promise<PulseAdminMembersResponseDto> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const items = await this.memberReadService.buildAdminMemberListItems(
      storeIds,
      query,
    );

    return {
      items,
      // 使用内存过滤后的数量作为 total，因为封禁状态存储在 Redis 中，
      // 数据库层过滤无法完整排除 banned 会员，需要二次过滤补全。
      total: items.length,
    };
  }

  async getAdminMemberDetail(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseMemberDetailDto> {
    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      memberId,
    );
    if (!canAccess) {
      throw new NotFoundException('会员不存在');
    }

    return this.memberReadService.buildAdminMemberDetail(memberId);
  }

  /**
   * 获取指定商家在 purelyClub C 端的会员运营统计。
   *
   * 数据源：marketing_customers + marketing_recharges
   * 等级映射：regular→free / silver→gold / gold→platinum / diamond→diamond
   */
  async getAdminMemberClubStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberClubStatsDto> {
    // 需求明确要求区分 404（不存在）和 403（无权限）
    // 先确认 store 是否存在
    const store = await this.prisma.store.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('会员不存在');
    }

    // 再确认当前用户是否有权限访问
    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      memberId,
    );
    if (!canAccess) {
      throw new ForbiddenException('暂无权限查看会员运营数据');
    }

    const storeId = memberId;

    // A. 会员主表聚合：总数 + 等级分布 + 余额合计
    const [customerStats, tierBreakdown] = await Promise.all([
      this.prisma.marketingCustomer.aggregate({
        where: { storeId },
        _count: { id: true },
        _sum: { balance: true },
      }),
      this.prisma.marketingCustomer.groupBy({
        by: ['tier'],
        where: { storeId },
        _count: { id: true },
      }),
    ]);

    const totalMemberCount = customerStats._count.id;
    const pendingBalanceFen = customerStats._sum.balance ?? 0;

    // 等级映射：regular→free / silver→gold / gold→platinum / diamond→diamond
    const tierToClubLevel = {
      regular: 'free',
      silver: 'gold',
      gold: 'platinum',
      diamond: 'diamond',
    } as const;
    const levelBreakdown: PulseAdminMemberClubLevelBreakdownDto = {
      free: 0,
      gold: 0,
      platinum: 0,
      diamond: 0,
    };
    for (const row of tierBreakdown) {
      const clubLevel =
        tierToClubLevel[row.tier as keyof typeof tierToClubLevel];
      if (clubLevel) {
        levelBreakdown[
          clubLevel as keyof PulseAdminMemberClubLevelBreakdownDto
        ] = row._count.id;
      }
    }

    // B+C. 充值订单聚合：累计总额/笔数 + 今日/本月/本年
    const now = new Date();
    const shanghaiOffset = 8 * 60 * 60_000;
    const shanghaiNow = new Date(now.getTime() + shanghaiOffset);

    // Asia/Shanghai 自然日起始
    const todayStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth(),
        shanghaiNow.getUTCDate(),
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );

    // 自然月起始
    const monthStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth(),
        1,
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );

    // 自然年起始
    const yearStart = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear(), 0, 1, 0, 0, 0, 0) - shanghaiOffset,
    );

    // 本季起始（按自然季度：Q1=01-03, Q2=04-06, Q3=07-09, Q4=10-12）
    const currentMonth = shanghaiNow.getUTCMonth();
    const quarterIndex = Math.floor(currentMonth / 3);
    const quarterStart = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear(), quarterIndex * 3, 1, 0, 0, 0, 0) -
        shanghaiOffset,
    );

    // 去年起始与结束
    const lastYearStart = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear() - 1, 0, 1, 0, 0, 0, 0) -
        shanghaiOffset,
    );
    const lastYearEnd = yearStart;

    // 本月结束时刻（下个月起始）
    const nextMonthStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth() + 1,
        1,
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );

    // 本季结束时刻（下一季起始）
    const nextQuarterIndex = quarterIndex + 1;
    const nextQuarterStart =
      nextQuarterIndex < 4
        ? new Date(
            Date.UTC(
              shanghaiNow.getUTCFullYear(),
              nextQuarterIndex * 3,
              1,
              0,
              0,
              0,
              0,
            ) - shanghaiOffset,
          )
        : new Date(
            Date.UTC(shanghaiNow.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0) -
              shanghaiOffset,
          );

    // 今年结束时刻（明年1月1日）
    const nextYearStart = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0) -
        shanghaiOffset,
    );

    // 今天结束时刻
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60_000);

    const rechargeBaseWhere = {
      storeId,
      type: 'recharge' as const,
    };

    const [
      totalRecharge,
      todayRecharge,
      monthRecharge,
      quarterRecharge,
      yearRecharge,
      lastYearRecharge,
    ] = await Promise.all([
      this.prisma.marketingRecharge.aggregate({
        where: rechargeBaseWhere,
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          ...rechargeBaseWhere,
          createdAt: { gte: todayStart, lt: todayEnd },
        },
        _sum: { amount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          ...rechargeBaseWhere,
          createdAt: { gte: monthStart, lt: nextMonthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          ...rechargeBaseWhere,
          createdAt: { gte: quarterStart, lt: nextQuarterStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          ...rechargeBaseWhere,
          createdAt: { gte: yearStart, lt: nextYearStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          ...rechargeBaseWhere,
          createdAt: { gte: lastYearStart, lt: lastYearEnd },
        },
        _sum: { amount: true },
      }),
    ]);

    const totalRechargeFen = totalRecharge._sum.amount ?? 0;
    const rechargeCount = totalRecharge._count.id;
    const todayRechargeFen = todayRecharge._sum.amount ?? 0;
    const monthRechargeFen = monthRecharge._sum.amount ?? 0;
    const quarterRechargeFen = quarterRecharge._sum.amount ?? 0;
    const yearRechargeFen = yearRecharge._sum.amount ?? 0;
    const lastYearRechargeFen = lastYearRecharge._sum.amount ?? 0;

    return {
      pendingBalanceFen,
      totalRechargeFen,
      totalMemberCount,
      rechargeCount,
      todayRechargeFen,
      monthRechargeFen,
      quarterRechargeFen,
      yearRechargeFen,
      lastYearRechargeFen,
      levelBreakdown,
    };
  }

  /**
   * 获取指定门店的在职员工候选列表，用于子账号槽位分配
   */
  async listAdminMemberEmployeeCandidates(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminEmployeeCandidateDto[]> {
    // 先确认 store 是否存在
    const store = await this.prisma.store.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('会员不存在');
    }

    // 再确认当前用户是否有权限访问
    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      memberId,
    );
    if (!canAccess) {
      throw new ForbiddenException('暂无权限查看员工候选列表');
    }

    return this.subAccountReadService.listAdminMemberEmployeeCandidates(
      memberId,
    );
  }

  /**
   * 获取指定商家的营业详情统计（销售额 + 利润，5 个周期）。
   */
  async getAdminMemberSalesStats(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<PulseAdminMemberSalesStatsDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('会员不存在');
    }

    const canAccess = await this.accessService.canAccessAdminMember(
      user,
      memberId,
    );
    if (!canAccess) {
      throw new ForbiddenException('暂无权限查看营业数据');
    }

    const storeId = memberId;
    const now = new Date();
    const shanghaiOffset = 8 * 60 * 60_000;
    const shanghaiNow = new Date(now.getTime() + shanghaiOffset);

    const todayStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth(),
        shanghaiNow.getUTCDate(),
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );

    const weekStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth(),
        shanghaiNow.getUTCDate() - shanghaiNow.getUTCDay(),
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );

    const monthStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth(),
        1,
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );

    const yearStart = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear(), 0, 1, 0, 0, 0, 0) - shanghaiOffset,
    );

    const lastYearStart = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear() - 1, 0, 1, 0, 0, 0, 0) -
        shanghaiOffset,
    );
    const lastYearEnd = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear(), 0, 1, 0, 0, 0, 0) - shanghaiOffset,
    );

    // 上一周期（环比）
    const prevTodayStart = new Date(todayStart.getTime() - 24 * 60 * 60_000);
    const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60_000);
    const prevMonthStart = new Date(
      Date.UTC(
        shanghaiNow.getUTCFullYear(),
        shanghaiNow.getUTCMonth() - 1,
        1,
        0,
        0,
        0,
        0,
      ) - shanghaiOffset,
    );
    const prevYearStart = new Date(
      Date.UTC(shanghaiNow.getUTCFullYear() - 1, 0, 1, 0, 0, 0, 0) -
        shanghaiOffset,
    );
    const prevYearEnd = yearStart;

    const shanghaiOffsetMs = shanghaiOffset;

    const [today, week, month, year, lastYear] = await Promise.all([
      this.buildSalesPeriodSummary(
        storeId,
        'today',
        todayStart,
        now,
        prevTodayStart,
        todayStart,
        'hour',
        shanghaiOffsetMs,
      ),
      this.buildSalesPeriodSummary(
        storeId,
        'week',
        weekStart,
        now,
        prevWeekStart,
        weekStart,
        'day',
        shanghaiOffsetMs,
      ),
      this.buildSalesPeriodSummary(
        storeId,
        'month',
        monthStart,
        now,
        prevMonthStart,
        monthStart,
        'day',
        shanghaiOffsetMs,
      ),
      this.buildSalesPeriodSummary(
        storeId,
        'year',
        yearStart,
        now,
        prevYearStart,
        prevYearEnd,
        'month',
        shanghaiOffsetMs,
      ),
      this.buildSalesPeriodSummary(
        storeId,
        'lastYear',
        lastYearStart,
        lastYearEnd,
        null,
        null,
        'month',
        shanghaiOffsetMs,
      ),
    ]);

    return { today, week, month, year, lastYear };
  }

  /** 聚合单个周期的销售汇总 + 数据点。 */
  private async buildSalesPeriodSummary(
    storeId: number,
    period: string,
    currentStart: Date,
    currentEnd: Date,
    previousStart: Date | null,
    previousEnd: Date | null,
    bucketGranularity: 'hour' | 'day' | 'month',
    shanghaiOffsetMs: number,
  ): Promise<PulseAdminMemberSalesPeriodSummaryDto> {
    const shanghaiOffsetSeconds = shanghaiOffsetMs / 1000;
    const granularityMap = {
      hour: 'hour',
      day: 'day',
      month: 'month',
    } as const;
    const granularityText = granularityMap[bucketGranularity];

    // 使用 Prisma.sql 安全地构建 date_trunc 的 text 参数，避免字符串拼接
    const [currentRows, previousRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          bucket: Date;
          sales: Prisma.Decimal | null;
          profit: Prisma.Decimal | null;
        }>
      >`
        SELECT
          date_trunc(${granularityText}::text,
            so.date + (${shanghaiOffsetSeconds} * interval '1 second')
          ) - (${shanghaiOffsetSeconds} * interval '1 second') AS bucket,
          COALESCE(SUM(so.total_revenue), 0) AS sales,
          COALESCE(SUM(so.total_profit), 0) AS profit
        FROM sale_orders so
        WHERE so.store_id = ${storeId}
          AND so.date >= ${currentStart}
          AND so.date <= ${currentEnd}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      previousStart && previousEnd
        ? this.prisma.$queryRaw<
            Array<{
              sales: Prisma.Decimal | null;
              profit: Prisma.Decimal | null;
            }>
          >`
            SELECT
              COALESCE(SUM(so.total_revenue), 0) AS sales,
              COALESCE(SUM(so.total_profit), 0) AS profit
            FROM sale_orders so
            WHERE so.store_id = ${storeId}
              AND so.date >= ${previousStart}
              AND so.date <= ${previousEnd}
          `
        : Promise.resolve([{ sales: null, profit: null }]),
    ]);

    const totalSalesFen = currentRows.reduce(
      (sum, r) => sum + Math.round(Number(r.sales ?? 0) * 100),
      0,
    );
    const totalProfitFen = currentRows.reduce(
      (sum, r) => sum + Math.round(Number(r.profit ?? 0) * 100),
      0,
    );

    const prevSales = Number(previousRows[0]?.sales ?? 0);
    const prevProfit = Number(previousRows[0]?.profit ?? 0);

    const salesGrowthPct =
      prevSales > 0
        ? Number(
            (((totalSalesFen / 100 - prevSales) / prevSales) * 100).toFixed(2),
          )
        : null;
    const profitGrowthPct =
      prevProfit > 0
        ? Number(
            (((totalProfitFen / 100 - prevProfit) / prevProfit) * 100).toFixed(
              2,
            ),
          )
        : null;

    const dataPoints = currentRows.map((row) => ({
      label: this.formatBucketLabel(
        row.bucket,
        bucketGranularity,
        shanghaiOffsetMs,
      ),
      salesFen: Math.round(Number(row.sales ?? 0) * 100),
      profitFen: Math.round(Number(row.profit ?? 0) * 100),
    }));

    return {
      period,
      totalSalesFen,
      totalProfitFen,
      salesGrowthPct,
      profitGrowthPct,
      dataPoints,
    };
  }

  /** 根据粒度格式化时间桶标签。 */
  private formatBucketLabel(
    bucket: Date,
    granularity: 'hour' | 'day' | 'month',
    shanghaiOffsetMs: number,
  ): string {
    const shanghaiTime = new Date(bucket.getTime() + shanghaiOffsetMs);
    if (granularity === 'hour') {
      return `${String(shanghaiTime.getUTCHours()).padStart(2, '0')}:00`;
    }
    if (granularity === 'day') {
      return `${String(shanghaiTime.getUTCMonth() + 1).padStart(2, '0')}/${String(shanghaiTime.getUTCDate()).padStart(2, '0')}`;
    }
    return `${shanghaiTime.getUTCMonth() + 1}月`;
  }

  private async listAdminLogs<
    TLogRecord extends { id: number; createdAt: Date },
  >(
    user: AuthenticatedUser,
    query: GetPulseAdminMemberLogsQueryDto,
    fetchLogs: (
      storeIds: number[],
      cursorPagination: ReturnType<
        typeof resolveAdminMemberLogsCursorPagination
      >,
    ) => Promise<TLogRecord[]>,
  ): Promise<{
    items: TLogRecord[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const storeIds = await this.accessService.resolveAdminMemberStoreIds(user);
    const cursorPagination = resolveAdminMemberLogsCursorPagination(query);
    const logs = await fetchLogs(storeIds, cursorPagination);
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
    };
  }
}
