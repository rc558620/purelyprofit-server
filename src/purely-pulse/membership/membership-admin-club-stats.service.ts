import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  PulseAdminMemberClubLevelBreakdownDto,
  PulseAdminMemberClubStatsDto,
} from './dto/pulse-membership-admin-club-stats.response.dto';
import { PulseMembershipAccessService } from './membership-access.service';

@Injectable()
export class PulseMembershipAdminClubStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseMembershipAccessService,
  ) {}

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
    // _sum.balance 返回 Prisma.Decimal | null，需显式转为 number
    const pendingBalanceFen = Number(customerStats._sum.balance ?? 0);

    // 等级映射：regular→free / gold→platinum / diamond→diamond
    const tierToClubLevel = {
      regular: 'free',
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
    const dateRanges = this.buildShanghaiDateRanges();

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
          createdAt: {
            gte: dateRanges.todayStart,
            lt: dateRanges.todayEnd,
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          ...rechargeBaseWhere,
          createdAt: {
            gte: dateRanges.monthStart,
            lt: dateRanges.nextMonthStart,
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          ...rechargeBaseWhere,
          createdAt: {
            gte: dateRanges.quarterStart,
            lt: dateRanges.nextQuarterStart,
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          ...rechargeBaseWhere,
          createdAt: {
            gte: dateRanges.yearStart,
            lt: dateRanges.nextYearStart,
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          ...rechargeBaseWhere,
          createdAt: {
            gte: dateRanges.lastYearStart,
            lt: dateRanges.lastYearEnd,
          },
        },
        _sum: { amount: true },
      }),
    ]);

    // _sum.amount 返回 Prisma.Decimal | null，需显式转为 number
    const totalRechargeFen = Number(totalRecharge._sum.amount ?? 0);
    const rechargeCount = totalRecharge._count.id;
    const todayRechargeFen = Number(todayRecharge._sum.amount ?? 0);
    const monthRechargeFen = Number(monthRecharge._sum.amount ?? 0);
    const quarterRechargeFen = Number(quarterRecharge._sum.amount ?? 0);
    const yearRechargeFen = Number(yearRecharge._sum.amount ?? 0);
    const lastYearRechargeFen = Number(lastYearRecharge._sum.amount ?? 0);

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

  /** 构建 Asia/Shanghai 时区下的各自然周期起止时刻。 */
  private buildShanghaiDateRanges() {
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

    // 自然季度起始
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

    return {
      todayStart,
      todayEnd,
      monthStart,
      nextMonthStart,
      quarterStart,
      nextQuarterStart,
      yearStart,
      nextYearStart,
      lastYearStart,
      lastYearEnd,
    };
  }
}
