import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildCostsRecordsCacheKey,
} from '../../../redis/keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import type { ListCostRecordsQueryDto } from './dto/costs-query.dto';
import type { CostRecordListResponseDto } from './dto/costs-response.dto';
import { buildCostRecordResponse } from './costs.mapper';
import { buildHistoryAwareCostRecordWhere } from './costs.query';
import {
  COSTS_RECORDS_CACHE_TTL_SECONDS,
  COSTS_RECORDS_REFRESH_AFTER_MS,
  resolveCallerIsSubAccount,
} from './costs-read.shared';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../commerce/commerce.utils';

const COST_RECORDS_DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class CostsReadRecordsService {
  private readonly maxPageSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly configService: ConfigService,
  ) {
    this.maxPageSize = this.configService.get<number>('app.maxPageSize', 100);
  }

  async listRecords(
    user: AuthenticatedUser,
    query: ListCostRecordsQueryDto,
  ): Promise<CostRecordListResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      undefined,
      'cost:view',
      '无权查看成本记录',
    );

    if (storeId === null) {
      const pagination = resolvePagination(
        query.page,
        query.pageSize,
        COST_RECORDS_DEFAULT_PAGE_SIZE,
        this.maxPageSize,
      );
      return {
        items: [],
        meta: buildPaginationMeta(0, pagination.page, pagination.take),
      };
    }

    const callerIsSubAccount = resolveCallerIsSubAccount(user);

    // 子账号直接查库，不走缓存
    if (callerIsSubAccount) {
      return this.buildRecordsList(storeId, query, callerIsSubAccount);
    }

    const cacheKey = buildCostsRecordsCacheKey(storeId, query);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: COSTS_RECORDS_CACHE_TTL_SECONDS,
      refreshAfterMs: COSTS_RECORDS_REFRESH_AFTER_MS,
      loadValue: () => this.buildRecordsList(storeId, query, false),
      refreshValue: () => this.buildRecordsList(storeId, query, false),
    });
  }

  private async buildRecordsList(
    storeId: number,
    query: ListCostRecordsQueryDto,
    callerIsSubAccount: boolean,
  ): Promise<CostRecordListResponseDto> {
    const where = await buildHistoryAwareCostRecordWhere(
      this.platformMembershipAccessService,
      storeId,
      query,
      callerIsSubAccount,
    );
    if (where === null) {
      const pagination = resolvePagination(
        query.page,
        query.pageSize,
        COST_RECORDS_DEFAULT_PAGE_SIZE,
        this.maxPageSize,
      );
      return {
        items: [],
        meta: buildPaginationMeta(0, pagination.page, pagination.take),
      };
    }

    const pagination = resolvePagination(
      query.page,
      query.pageSize,
      COST_RECORDS_DEFAULT_PAGE_SIZE,
      this.maxPageSize,
    );

    const [records, total] = await Promise.all([
      this.prisma.costRecord.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.costRecord.count({ where }),
    ]);

    return {
      items: records.map(buildCostRecordResponse),
      meta: buildPaginationMeta(total, pagination.page, pagination.take),
    };
  }
}
