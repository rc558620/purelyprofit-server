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
import type { CostRecordResponseSource } from './costs.types';
import { buildCostRecordResponse } from './costs.mapper';
import { buildHistoryAwareCostRecordWhere } from './costs.query';
import {
  buildCostRecordCursorWhere,
  COST_RECORD_ORDER_BY,
  encodeCostRecordCursor,
  resolveCostRecordPaging,
} from './costs.cursor';
import type { CostRecordPaging } from './costs.cursor';
import {
  COSTS_RECORDS_CACHE_TTL_SECONDS,
  COSTS_RECORDS_REFRESH_AFTER_MS,
  resolveCallerIsSubAccount,
} from './costs-read.shared';
import { buildPaginationMeta } from '../../commerce/commerce.utils';

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
    // 入参校验先于缓存与取数：cursor 非法时直接 400，不白跑一次查询
    const paging = resolveCostRecordPaging(query, this.maxPageSize);

    if (storeId === null) {
      return buildEmptyRecordsPage(paging);
    }

    const callerIsSubAccount = resolveCallerIsSubAccount(user);

    // 游标页不进缓存：cursor 天生一次性，按 cursor 拼 key 会让缓存无界增长，
    // 且无法被 buildCostsRecordsPattern 的统一失效覆盖。子账号同样直接查库。
    if (callerIsSubAccount || paging.cursor) {
      return this.buildRecordsList(storeId, query, callerIsSubAccount, paging);
    }

    const cacheKey = buildCostsRecordsCacheKey(storeId, query);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: COSTS_RECORDS_CACHE_TTL_SECONDS,
      refreshAfterMs: COSTS_RECORDS_REFRESH_AFTER_MS,
      loadValue: () => this.buildRecordsList(storeId, query, false, paging),
      refreshValue: () => this.buildRecordsList(storeId, query, false, paging),
    });
  }

  private async buildRecordsList(
    storeId: number,
    query: ListCostRecordsQueryDto,
    callerIsSubAccount: boolean,
    paging: CostRecordPaging,
  ): Promise<CostRecordListResponseDto> {
    const baseWhere = await buildHistoryAwareCostRecordWhere(
      this.platformMembershipAccessService,
      storeId,
      query,
      callerIsSubAccount,
    );
    if (baseWhere === null) {
      return buildEmptyRecordsPage(paging);
    }

    // total 恒为全量口径：count 用不带游标的筛选，否则翻页时 total 会一路变小
    const listWhere = paging.cursor
      ? { AND: [baseWhere, buildCostRecordCursorWhere(paging.cursor)] }
      : baseWhere;
    const [records, total] = await Promise.all([
      this.prisma.costRecord.findMany({
        where: listWhere,
        orderBy: COST_RECORD_ORDER_BY,
        // 游标路径不需要 skip：where 已排除游标之前的行；offset 路径保留旧语义
        ...(paging.cursor ? {} : { skip: paging.offset }),
        // 游标路径多取一行做「是否还有下一页」探测，省掉一次额外查询
        take: paging.cursor ? paging.limit + 1 : paging.limit,
      }),
      this.prisma.costRecord.count({ where: baseWhere }),
    ]);

    return buildRecordsPage(records, total, paging);
  }
}

/** 空页响应：meta 口径与迁移前一致，仅新增游标字段 */
function buildEmptyRecordsPage(
  paging: CostRecordPaging,
): CostRecordListResponseDto {
  return {
    items: [],
    meta: buildPaginationMeta(0, paging.page, paging.limit),
    hasMore: false,
    nextCursor: null,
  };
}

/**
 * 列表响应组装。
 *
 * 到底判定分两条路径：游标路径靠 `take = limit + 1` 的探测行；offset 路径没有
 * 探测行，只能用 `offset + 已取条数 < total` 推导。两条路径都产出 nextCursor，
 * 前端可逐步从 page 切到游标而不必等后端改造。
 */
function buildRecordsPage(
  records: CostRecordResponseSource[],
  total: number,
  paging: CostRecordPaging,
): CostRecordListResponseDto {
  const hasMore = paging.cursor
    ? records.length > paging.limit
    : paging.offset + records.length < total;
  const pageRecords = paging.cursor ? records.slice(0, paging.limit) : records;
  const lastRecord = pageRecords.at(-1);
  return {
    items: pageRecords.map((record) => buildCostRecordResponse(record)),
    meta: buildPaginationMeta(total, paging.page, paging.limit),
    hasMore,
    nextCursor:
      hasMore && lastRecord ? encodeCostRecordCursor(lastRecord) : null,
  };
}
