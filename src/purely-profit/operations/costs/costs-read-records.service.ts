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
import type { CostRecordResponseDto } from './dto/costs-response.dto';
import { buildCostRecordResponse } from './costs.mapper';
import { buildHistoryAwareCostRecordWhere } from './costs.query';
import {
  COSTS_RECORDS_CACHE_TTL_SECONDS,
  COSTS_RECORDS_REFRESH_AFTER_MS,
  resolveCallerIsSubAccount,
} from './costs-read.shared';

@Injectable()
export class CostsReadRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly configService: ConfigService,
  ) {}

  async listRecords(
    user: AuthenticatedUser,
    query: ListCostRecordsQueryDto,
  ): Promise<CostRecordResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      undefined,
      'cost:view',
      '无权查看成本记录',
    );

    if (storeId === null) {
      return [];
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
  ): Promise<CostRecordResponseDto[]> {
    const where = await buildHistoryAwareCostRecordWhere(
      this.platformMembershipAccessService,
      storeId,
      query,
      callerIsSubAccount,
    );
    if (where === null) {
      return [];
    }

    const maxPageSize = this.configService.get<number>('app.maxPageSize', 100);
    const records = await this.prisma.costRecord.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: maxPageSize,
    });

    return records.map(buildCostRecordResponse);
  }
}
