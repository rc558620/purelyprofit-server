import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { Money, calcPercentOfTotal } from '../../../shared/money.utils';
import {
  addShanghaiDays,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildCostsDashboardCacheKey,
} from '../../../redis/keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import type { CostRecordStatsQueryDto } from './dto/costs-query.dto';
import type { CostDashboardResponseDto } from './dto/costs-response.dto';
import { buildEmptyCostDashboardResponse } from './costs.domain';
import { buildCostDashboardTrend } from './costs.mapper';
import { buildHistoryAwareCostRecordWhere } from './costs.query';
import { COST_CATEGORY_META } from './costs.types';
import {
  COSTS_DASHBOARD_CACHE_TTL_SECONDS,
  COSTS_DASHBOARD_REFRESH_AFTER_MS,
  calculatePreviousPeriodChange,
  resolveCallerIsSubAccount,
} from './costs-read.shared';

@Injectable()
export class CostsReadDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getDashboard(
    user: AuthenticatedUser,
    query: CostRecordStatsQueryDto,
  ): Promise<CostDashboardResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      undefined,
      'cost:view',
      '无权查看成本数据',
    );

    if (storeId === null) {
      return buildEmptyCostDashboardResponse();
    }

    const callerIsSubAccount = resolveCallerIsSubAccount(user);

    // 子账号直接查库，不走缓存
    if (callerIsSubAccount) {
      return this.buildDashboard(storeId, query, callerIsSubAccount);
    }

    const cacheKey = buildCostsDashboardCacheKey(storeId, query);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: COSTS_DASHBOARD_CACHE_TTL_SECONDS,
      refreshAfterMs: COSTS_DASHBOARD_REFRESH_AFTER_MS,
      loadValue: () => this.buildDashboard(storeId, query, false),
      refreshValue: () => this.buildDashboard(storeId, query, false),
    });
  }

  private async buildDashboard(
    storeId: number,
    query: CostRecordStatsQueryDto,
    callerIsSubAccount: boolean,
  ): Promise<CostDashboardResponseDto> {
    const currentWhere = await buildHistoryAwareCostRecordWhere(
      this.platformMembershipAccessService,
      storeId,
      query,
      callerIsSubAccount,
    );
    if (currentWhere === null) {
      return buildEmptyCostDashboardResponse();
    }

    // summary：复用 stats 逻辑，Prisma 聚合
    const currentAggregate = await this.prisma.costRecord.aggregate({
      where: currentWhere,
      _sum: { amount: true },
      _count: { _all: true },
    });
    const currentTypeRows = await this.prisma.costRecord.groupBy({
      by: ['type'],
      where: currentWhere,
      _sum: { amount: true },
    });

    const totalMoney = Money.fromDbCents(
      Number(currentAggregate._sum.amount ?? 0),
    );
    const fixedMoney = Money.fromDbCents(
      Number(
        currentTypeRows.find((record) => record.type === 'fixed')?._sum
          .amount ?? 0,
      ),
    );
    // 与 stats 接口口径一致：变动支出按 type='variable' 聚合，而非 total - fixed，
    // 避免两者在四舍五入/精度上出现偏差。
    const variableMoney = Money.fromDbCents(
      Number(
        currentTypeRows.find((record) => record.type === 'variable')?._sum
          .amount ?? 0,
      ),
    );

    const total = totalMoney.toOutputYuan();
    const fixed = fixedMoney.toOutputYuan();
    const variable = variableMoney.toOutputYuan();

    const compareLastPeriod = await calculatePreviousPeriodChange(
      this.prisma,
      this.platformMembershipAccessService,
      storeId,
      query,
      total,
      callerIsSubAccount,
    );

    // categories：按分类聚合
    const categoryRows = await this.prisma.costRecord.groupBy({
      by: ['category'],
      where: currentWhere,
      _sum: { amount: true },
    });

    const categories = categoryRows
      .map((row) => {
        const categoryAmount = Money.fromDbCents(
          Number(row._sum.amount ?? 0),
        ).toOutputYuan();
        return {
          category: row.category,
          label: COST_CATEGORY_META[row.category]?.label ?? row.category,
          amount: categoryAmount,
          percentage: calcPercentOfTotal(categoryAmount, total),
          color: COST_CATEGORY_META[row.category]?.color ?? '#94a3b8',
        };
      })
      .sort((left, right) => right.amount - left.amount);

    // trend：近 7 日数据（与当前筛选周期解耦，固定为「相对今天」的窗口），
    // 仅沿用 storeId 与 typeFilter，不再叠加 period 的日期上/下界，
    // 否则自定义历史区间（如过去的 custom_range）会与 gte=近7日 无交集而返回空趋势。
    // 上海时区的「今天零点」向前推 6 天，保证与前端展示的日历日一致
    const sevenDaysAgo = new Date(
      addShanghaiDays(getShanghaiDayStartMs(Date.now()), -6),
    );

    const trendWhere: typeof currentWhere = {
      ...currentWhere,
      date: { gte: sevenDaysAgo },
    };

    const trendRows = await this.prisma.costRecord.findMany({
      where: trendWhere,
      select: { type: true, category: true, amount: true, date: true },
      orderBy: [{ date: 'desc' }],
    });

    const trend = buildCostDashboardTrend(trendRows);

    return {
      summary: {
        total,
        fixed,
        variable,
        compareLastPeriod,
        recordCount: currentAggregate._count._all,
      },
      categories,
      trend,
    };
  }
}
