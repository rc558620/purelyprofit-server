import { ConflictException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import {
  buildPulseGrowthAdminPartnerApplicationsCacheKey,
  buildPulseGrowthAdminPayoutsCacheKey,
} from '../pulse.cache-keys';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import {
  PULSE_ADMIN_PARTNER_APPLICATION_DEFAULT_LIMIT,
  PULSE_ADMIN_PAYOUT_DEFAULT_LIMIT,
  type GetPulseAdminPartnerApplicationsQueryDto,
  type GetPulseAdminPayoutsQueryDto,
  type PulseAdminPartnerApplicationsResponseDto,
  type PulseAdminPayoutsResponseDto,
} from './dto/pulse-growth-admin.dto';
import {
  buildAdminPartnerApplicationsResponse,
  buildAdminPayoutsResponse,
  buildAdminPromoDetailResponse,
  parseAdminPartnerApplicationsCursor,
  parseAdminPayoutsCursor,
  resolvePromoDateRange,
} from './growth-admin.domain';
import type { PulseAdminPromoDetailResponse } from './growth-admin.domain';
import { PulseGrowthAccessService } from './growth-access.service';
import {
  queryAdminPartnerApplications,
  queryAdminPartnerApplicationStats,
  queryAdminPromoPartners,
} from './growth-admin.query';
import {
  queryAdminPayouts,
  queryAdminPayoutStats,
} from './growth-admin-payout.query';

const PULSE_GROWTH_ADMIN_CACHE_TTL_SECONDS = 30;
const PULSE_GROWTH_ADMIN_REFRESH_AFTER_MS = 10_000;

@Injectable()
export class PulseGrowthAdminQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly accessService: PulseGrowthAccessService,
  ) {}

  async getAdminPromoDetail(
    user: AuthenticatedUser,
    rawQuery: Record<string, unknown>,
  ): Promise<PulseAdminPromoDetailResponse> {
    const storeWhere = await this.accessService.buildAdminStoreWhere(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法查看推广详情',
    });
    const dateRange = resolvePromoDateRange(rawQuery);
    const partners = await queryAdminPromoPartners(this.prisma, storeWhere);

    return buildAdminPromoDetailResponse(partners, dateRange);
  }

  async listAdminPartnerApplications(
    user: AuthenticatedUser,
    query: GetPulseAdminPartnerApplicationsQueryDto,
  ): Promise<PulseAdminPartnerApplicationsResponseDto> {
    const where = await this.accessService.buildPartnerApplicationWhere(user);
    const cursorPagination =
      this.resolveAdminPartnerApplicationsCursorPagination(query);
    const cacheKey = buildPulseGrowthAdminPartnerApplicationsCacheKey({
      mode: user.pulseMode ?? 'normal',
      scope: this.resolveAdminScope(where),
      tab: query.tab,
      cursor: query.cursor,
      limit: cursorPagination.limit,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PULSE_GROWTH_ADMIN_CACHE_TTL_SECONDS,
      refreshAfterMs: PULSE_GROWTH_ADMIN_REFRESH_AFTER_MS,
      loadValue: () =>
        this.buildAdminPartnerApplicationsResponse(
          where,
          query,
          cursorPagination,
        ),
      refreshValue: () =>
        this.buildAdminPartnerApplicationsResponse(
          where,
          query,
          cursorPagination,
        ),
    });
  }

  async listAdminPayouts(
    user: AuthenticatedUser,
    query: GetPulseAdminPayoutsQueryDto,
  ): Promise<PulseAdminPayoutsResponseDto> {
    const where = await this.accessService.buildAdminPayoutWhere(user);
    const cursorPagination = this.resolveAdminPayoutCursorPagination(query);
    const cacheKey = buildPulseGrowthAdminPayoutsCacheKey({
      mode: user.pulseMode ?? 'normal',
      scope: this.resolveAdminScope(where),
      tab: query.tab,
      cursor: query.cursor,
      limit: cursorPagination.limit,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PULSE_GROWTH_ADMIN_CACHE_TTL_SECONDS,
      refreshAfterMs: PULSE_GROWTH_ADMIN_REFRESH_AFTER_MS,
      loadValue: () =>
        this.buildAdminPayoutsResponse(where, query, cursorPagination),
      refreshValue: () =>
        this.buildAdminPayoutsResponse(where, query, cursorPagination),
    });
  }

  private async buildAdminPartnerApplicationsResponse(
    where: Awaited<
      ReturnType<PulseGrowthAccessService['buildPartnerApplicationWhere']>
    >,
    query: GetPulseAdminPartnerApplicationsQueryDto,
    cursorPagination: {
      cursor?: { createdAt: Date; id: number };
      limit?: number;
    },
  ): Promise<PulseAdminPartnerApplicationsResponseDto> {
    const [applications, stats] = await Promise.all([
      queryAdminPartnerApplications(this.prisma, {
        where,
        tab: query.tab,
        cursor: cursorPagination.cursor,
        limit: cursorPagination.limit,
      }),
      queryAdminPartnerApplicationStats(this.prisma, where),
    ]);

    return buildAdminPartnerApplicationsResponse({
      applications,
      stats,
      limit: cursorPagination.limit,
    });
  }

  private async buildAdminPayoutsResponse(
    where: Awaited<
      ReturnType<PulseGrowthAccessService['buildAdminPayoutWhere']>
    >,
    query: GetPulseAdminPayoutsQueryDto,
    cursorPagination: {
      cursor?: { appliedAt: Date; id: number };
      limit?: number;
    },
  ): Promise<PulseAdminPayoutsResponseDto> {
    const [withdrawals, stats] = await Promise.all([
      queryAdminPayouts(this.prisma, {
        where,
        tab: query.tab,
        cursor: cursorPagination.cursor,
        limit: cursorPagination.limit,
      }),
      queryAdminPayoutStats(this.prisma, where),
    ]);

    return buildAdminPayoutsResponse({
      withdrawals,
      stats,
      limit: cursorPagination.limit,
    });
  }

  private resolveAdminScope(
    where:
      | Awaited<
          ReturnType<PulseGrowthAccessService['buildPartnerApplicationWhere']>
        >
      | Awaited<ReturnType<PulseGrowthAccessService['buildAdminPayoutWhere']>>,
  ): string {
    if (typeof where.storeId === 'number') {
      return `store:${where.storeId}`;
    }

    return `all:${this.accessService.getDevEmailsFingerprint()}`;
  }

  private resolveAdminPartnerApplicationsCursorPagination(
    query: GetPulseAdminPartnerApplicationsQueryDto,
  ): {
    cursor?: { createdAt: Date; id: number };
    limit?: number;
  } {
    if (query.cursor === undefined && query.limit === undefined) {
      return {};
    }

    if (query.cursor === undefined) {
      return {
        limit: query.limit ?? PULSE_ADMIN_PARTNER_APPLICATION_DEFAULT_LIMIT,
      };
    }

    const cursor = parseAdminPartnerApplicationsCursor(query.cursor);
    if (!cursor) {
      throw new ConflictException('cursor 格式不合法');
    }

    return {
      cursor,
      limit: query.limit ?? PULSE_ADMIN_PARTNER_APPLICATION_DEFAULT_LIMIT,
    };
  }

  private resolveAdminPayoutCursorPagination(
    query: GetPulseAdminPayoutsQueryDto,
  ): {
    cursor?: { appliedAt: Date; id: number };
    limit?: number;
  } {
    if (query.cursor === undefined && query.limit === undefined) {
      return {};
    }

    if (query.cursor === undefined) {
      return {
        limit: query.limit ?? PULSE_ADMIN_PAYOUT_DEFAULT_LIMIT,
      };
    }

    const cursor = parseAdminPayoutsCursor(query.cursor);
    if (!cursor) {
      throw new ConflictException('cursor 格式不合法');
    }

    return {
      cursor,
      limit: query.limit ?? PULSE_ADMIN_PAYOUT_DEFAULT_LIMIT,
    };
  }
}
