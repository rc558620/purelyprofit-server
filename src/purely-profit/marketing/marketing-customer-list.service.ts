import { Injectable } from '@nestjs/common';
import type { MarketingCustomerRow } from './marketing.types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildMarketingCustomersListCacheKey } from '../../redis/cache-keys';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import type { ListCustomersQueryDto } from './dto/marketing-query.dto';
import type { MarketingCustomersResponseDto } from './dto/marketing-response.dto';
import { mapCustomerRow } from './marketing.mapper';
import { buildCustomerWhere } from './marketing.domain';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
} from './marketing.utils';

const MARKETING_CUSTOMERS_LIST_CACHE_TTL_SECONDS = 60;
const MARKETING_CUSTOMERS_LIST_REFRESH_AFTER_MS = 20_000;

@Injectable()
export class MarketingCustomerListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  async listCustomers(
    resolvedStoreId: number,
    query: ListCustomersQueryDto,
  ): Promise<MarketingCustomersResponseDto> {
    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const statusFilter = query.status ?? 'all';
    const tierFilter = query.tier ?? 'all';
    const keywordFilter = query.keyword ?? '';
    const nameFilter = query.name ?? '';
    const phoneFilter = query.phone ?? '';
    const cacheKey = buildMarketingCustomersListCacheKey(
      resolvedStoreId,
      statusFilter,
      tierFilter,
      keywordFilter,
      page,
      take,
      nameFilter,
      phoneFilter,
    );

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MARKETING_CUSTOMERS_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: MARKETING_CUSTOMERS_LIST_REFRESH_AFTER_MS,
      loadValue: () =>
        this.queryCustomers(
          resolvedStoreId,
          statusFilter,
          tierFilter,
          keywordFilter,
          nameFilter,
          phoneFilter,
          skip,
          take,
          page,
        ),
    });
  }

  private async queryCustomers(
    resolvedStoreId: number,
    statusFilter: string,
    tierFilter: string,
    keywordFilter: string,
    nameFilter: string,
    phoneFilter: string,
    skip: number,
    take: number,
    page: number,
  ): Promise<MarketingCustomersResponseDto> {
    const where = buildCustomerWhere({
      storeId: resolvedStoreId,
      status:
        statusFilter !== 'all'
          ? (statusFilter as 'active' | 'dormant' | 'lost')
          : undefined,
      tier:
        tierFilter !== 'all'
          ? (tierFilter as 'regular' | 'gold' | 'diamond')
          : undefined,
      keyword: keywordFilter || undefined,
      name: nameFilter || undefined,
      phone: phoneFilter || undefined,
    });

    const [rows, total] = await Promise.all([
      this.prisma.marketingCustomer.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          storeId: true,
          name: true,
          phone: true,
          avatar: true,
          tier: true,
          balance: true,
          points: true,
          totalSpent: true,
          visitCount: true,
          lastVisitAt: true,
          remark: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.marketingCustomer.count({ where }),
    ]);

    // 对 avatar 为 null 的行，通过多种路径从 users 表 fallback 获取头像
    await this.fillAvatarsFromUsers(rows);

    // F9: 实时从 marketing_consumptions 聚合 totalSpent / visitCount / lastVisitAt，
    // 作为权威值覆盖物化字段，避免历史数据迁移/事务不一致导致的金额与次数错位
    await this.overrideMetricsFromConsumptions(rows);

    return {
      items: rows.map(mapCustomerRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  /**
   * F9: 从 marketing_consumptions 按 customerId 聚合，覆盖 marketing_customers 表上的
   * totalSpent / visitCount / lastVisitAt 物化字段。
   *
   * 触发原因：物化字段在历史数据迁移、C 端扫码订单路径与商家端手动消费路径间存在口径差，
   * 单独依赖物化字段会导致"金额高但次数为 0"等错位展示。这里改用实时聚合作为权威值。
   *
   * @param rows 列表查询出的 customer 行（会被原地修改 totalSpent/visitCount/lastVisitAt）
   */
  private async overrideMetricsFromConsumptions(
    rows: Pick<
      MarketingCustomerRow,
      'id' | 'totalSpent' | 'visitCount' | 'lastVisitAt'
    >[],
  ): Promise<void> {
    if (rows.length === 0) return;

    const customerIds = rows.map((r) => r.id);

    // groupBy 一次拿到每人的 SUM(amount)、COUNT(*) 与 MAX(createdAt)
    const aggregates = await this.prisma.marketingConsumption.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds } },
      _sum: { amount: true },
      _count: { _all: true },
      _max: { createdAt: true },
    });

    const aggregateMap = new Map<
      number,
      { totalSpent: number; visitCount: number; lastVisitAt: Date | null }
    >();
    for (const a of aggregates) {
      aggregateMap.set(a.customerId, {
        totalSpent: a._sum.amount ?? 0,
        visitCount: a._count._all,
        lastVisitAt: a._max.createdAt ?? null,
      });
    }

    for (const row of rows) {
      const agg = aggregateMap.get(row.id);
      if (!agg) continue;
      // 仅在消费表里存在记录时才覆盖——避免孤儿 customer（无消费记录）被强制归零
      if (agg.totalSpent > 0 || agg.visitCount > 0) {
        row.totalSpent = agg.totalSpent;
        row.visitCount = agg.visitCount;
        if (agg.lastVisitAt) {
          row.lastVisitAt = agg.lastVisitAt;
        }
      }
    }
  }

  /**
   * 对 avatar 为 null 的行，通过 wechatPhone / club_phone email / phone_ email
   * 多路径从 users 表 fallback 获取头像
   */
  private async fillAvatarsFromUsers(
    rows: { avatar: string | null; phone: string | null }[],
  ): Promise<void> {
    const phones = rows
      .filter((r) => !r.avatar && r.phone)
      .map((r) => r.phone as string);

    if (phones.length === 0) return;

    const emailVariants = phones.flatMap((p) => [
      `club_phone_${p}@purelyprofit.local`,
      `phone_${p}@purelyprofit.local`,
    ]);

    const usersWithAvatar = await this.prisma.user.findMany({
      where: {
        OR: [{ wechatPhone: { in: phones } }, { email: { in: emailVariants } }],
      },
      select: {
        id: true,
        wechatPhone: true,
        email: true,
        avatar: true,
        wechatAvatar: true,
      },
    });

    // 构建分层映射，确保头像解析优先级与详情页 SQL CASE ORDER BY 一致
    // 优先级: wechat_phone(1) → club_phone email(2) → phone_ email(3)
    const phoneAvatarMap = new Map<string, string>();
    const emailAvatarMap = new Map<string, string>();
    for (const u of usersWithAvatar) {
      const avatarUrl = u.avatar ?? u.wechatAvatar;
      if (avatarUrl) {
        if (u.wechatPhone) phoneAvatarMap.set(u.wechatPhone, avatarUrl);
        if (u.email) emailAvatarMap.set(u.email, avatarUrl);
      }
    }

    for (const row of rows) {
      if (row.avatar || !row.phone) continue;
      const clubEmail = `club_phone_${row.phone}@purelyprofit.local`;
      const legacyEmail = `phone_${row.phone}@purelyprofit.local`;
      row.avatar =
        phoneAvatarMap.get(row.phone) ??
        emailAvatarMap.get(clubEmail) ??
        emailAvatarMap.get(legacyEmail) ??
        null;
    }
  }
}
