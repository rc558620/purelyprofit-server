import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildMembersListCacheKey,
  buildMembersMetaCacheKey,
  buildMembersOverviewCacheKey,
  buildMembersSnapshotsCacheKey,
} from '../../../redis/keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import {
  MemberMetaQueryDto,
  MembersMetaResponseDto,
} from './dto/member-meta.dto';
import {
  MemberOverviewQueryDto,
  MembersOverviewResponseDto,
} from './dto/member-overview.dto';
import {
  ListMembersQueryDto,
  ListMemberSnapshotsQueryDto,
  MemberResponseDto,
  MemberSnapshotDto,
  PaginatedMembersResponseDto,
} from './dto/member-response.dto';
import { MembersAccessService } from './members-access.service';
import {
  buildEmptyMembersOverviewResponse,
  buildMemberLevelMetaRows,
  buildMemberStatusMetaRows,
} from './members.domain';
import { type MemberRecord, toMemberResponse } from './members.mapper';
import { toMemberSnapshotResponses } from './members.snapshot.mapper';
import {
  queryMemberRechargeHistories,
  queryMemberRechargeHistory,
  queryMemberSnapshots,
  queryMembersMeta,
  queryMembersOverview,
  queryMembersPage,
} from './members.query';
import { buildPaginationMeta, toDbMemberStatus } from './members.utils';
import {
  encodeMemberListCursor,
  resolveMemberListPaging,
} from './members.cursor';
import type { MemberListPaging } from './members.cursor';

const MEMBERS_LIST_CACHE_TTL_SECONDS = 90;
const MEMBERS_LIST_REFRESH_AFTER_MS = 20_000;
const MEMBERS_META_CACHE_TTL_SECONDS = 300;
const MEMBERS_META_REFRESH_AFTER_MS = 60_000;
const MEMBERS_OVERVIEW_CACHE_TTL_SECONDS = 120;
const MEMBERS_OVERVIEW_REFRESH_AFTER_MS = 30_000;
const MEMBERS_SNAPSHOTS_CACHE_TTL_SECONDS = 120;
const MEMBERS_SNAPSHOTS_REFRESH_AFTER_MS = 30_000;

@Injectable()
export class MembersReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membersAccessService: MembersAccessService,
    private readonly configService: ConfigService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListMembersQueryDto,
  ): Promise<PaginatedMembersResponseDto> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店会员列表',
    );
    // 入参校验先于缓存与取数：cursor 非法时直接 400，不白跑一次查询
    const paging = resolveMemberListPaging(query, this.resolvePagingBounds());

    if (storeId === null) {
      return buildEmptyMembersPage(paging);
    }

    // 游标页不进缓存：cursor 天生一次性，按 cursor 拼 key 会让缓存无界增长，
    // 且无法被会员列表的统一失效 pattern 覆盖。
    if (paging.cursor) {
      return this.buildMemberListPage(storeId, query, paging);
    }

    const cacheKey = buildMembersListCacheKey(storeId, {
      status: query.status,
      level: query.level,
      keyword: query.keyword,
      partner: query.partner,
      page: paging.page,
      pageSize: paging.limit,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MEMBERS_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: MEMBERS_LIST_REFRESH_AFTER_MS,
      loadValue: () => this.buildMemberListPage(storeId, query, paging),
    });
  }

  /**
   * 会员列表取数与响应组装（两条路径共用）。
   *
   * 到底判定分两条：游标路径靠 `take = limit + 1` 的探测行；offset 路径没有探测行，
   * 只能用 `offset + 已取条数 < total` 推导。两条路径都产出 nextCursor。
   */
  private async buildMemberListPage(
    storeId: number,
    query: ListMembersQueryDto,
    paging: MemberListPaging,
  ): Promise<PaginatedMembersResponseDto> {
    const { items, total } = await queryMembersPage(this.prisma, {
      storeId,
      status: toDbMemberStatus(query.status),
      level: query.level,
      keyword: query.keyword,
      onlyPartners: query.partner,
      skip: paging.offset,
      take: paging.cursor ? paging.limit + 1 : paging.limit,
      cursor: paging.cursor,
    });

    const hasMore = paging.cursor
      ? items.length > paging.limit
      : paging.offset + items.length < total;
    const pageItems = paging.cursor ? items.slice(0, paging.limit) : items;
    // 列表必须与详情口径一致：批量带出充值记录，避免 rechargeHistory 恒为空
    const rechargeRecordsByMemberId = await queryMemberRechargeHistories(
      this.prisma,
      pageItems.map((item) => item.id),
    );
    const lastItem = pageItems.at(-1);

    return {
      items: pageItems.map((item) =>
        toMemberResponse(item, rechargeRecordsByMemberId.get(item.id) ?? []),
      ),
      meta: buildPaginationMeta(total, paging.page, paging.limit),
      hasMore,
      nextCursor: hasMore && lastItem ? encodeMemberListCursor(lastItem) : null,
    };
  }

  async getMeta(
    user: AuthenticatedUser,
    query: MemberMetaQueryDto,
  ): Promise<MembersMetaResponseDto> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店会员筛选项',
    );

    if (storeId === null) {
      // 与有门店时结构保持一致：等级、状态都给出完整的选项集（命中数全为 0），
      // 否则前端筛选项会出现「状态有 3 项、等级一项没有」的不对称下拉。
      return {
        levels: buildMemberLevelMetaRows([]),
        statuses: buildMemberStatusMetaRows([]),
      };
    }

    const cacheKey = buildMembersMetaCacheKey(storeId);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MEMBERS_META_CACHE_TTL_SECONDS,
      refreshAfterMs: MEMBERS_META_REFRESH_AFTER_MS,
      loadValue: async () => {
        return this.buildMetaPayload(storeId);
      },
    });
  }

  async getOverview(
    user: AuthenticatedUser,
    query: MemberOverviewQueryDto,
  ): Promise<MembersOverviewResponseDto> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店会员概览',
    );

    if (storeId === null) {
      return buildEmptyMembersOverviewResponse();
    }

    const cacheKey = buildMembersOverviewCacheKey(storeId);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MEMBERS_OVERVIEW_CACHE_TTL_SECONDS,
      refreshAfterMs: MEMBERS_OVERVIEW_REFRESH_AFTER_MS,
      loadValue: async () => this.buildOverviewPayload(storeId),
    });
  }

  async warmMetaCache(storeId: number): Promise<MembersMetaResponseDto> {
    const cacheKey = buildMembersMetaCacheKey(storeId);
    const data = await this.buildMetaPayload(storeId);
    await this.refreshableCache.writeRefreshableJson(
      cacheKey,
      data,
      MEMBERS_META_CACHE_TTL_SECONDS,
      MEMBERS_META_REFRESH_AFTER_MS,
    );
    return data;
  }

  async warmOverviewCache(
    storeId: number,
  ): Promise<MembersOverviewResponseDto> {
    const cacheKey = buildMembersOverviewCacheKey(storeId);
    const data = await this.buildOverviewPayload(storeId);
    await this.refreshableCache.writeRefreshableJson(
      cacheKey,
      data,
      MEMBERS_OVERVIEW_CACHE_TTL_SECONDS,
      MEMBERS_OVERVIEW_REFRESH_AFTER_MS,
    );
    return data;
  }

  async listSnapshots(
    user: AuthenticatedUser,
    query: ListMemberSnapshotsQueryDto,
  ): Promise<MemberSnapshotDto[]> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      '无权查看该门店会员快照',
    );

    if (storeId === null) {
      return [];
    }

    const cacheKey = buildMembersSnapshotsCacheKey(storeId, {
      keyword: query.keyword,
      onlyPartners: query.onlyPartners,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MEMBERS_SNAPSHOTS_CACHE_TTL_SECONDS,
      refreshAfterMs: MEMBERS_SNAPSHOTS_REFRESH_AFTER_MS,
      loadValue: async () =>
        toMemberSnapshotResponses(
          await queryMemberSnapshots(this.prisma, {
            storeId,
            keyword: query.keyword,
            onlyPartners: query.onlyPartners,
          }),
        ),
    });
  }

  async getDetail(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<MemberResponseDto> {
    const member = await this.membersAccessService.findManageableMemberOrThrow(
      user,
      memberId,
      'members:view',
    );
    return this.buildMemberResponse(member);
  }

  private resolveViewStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    forbiddenMessage: string,
  ): Promise<number | null> {
    return this.membersAccessService.resolveMembersViewStoreId(
      user,
      storeId,
      forbiddenMessage,
    );
  }

  private async buildMetaPayload(
    storeId: number,
  ): Promise<MembersMetaResponseDto> {
    const { levelRows, statusRows } = await queryMembersMeta(
      this.prisma,
      storeId,
    );

    return {
      levels: buildMemberLevelMetaRows(levelRows),
      statuses: buildMemberStatusMetaRows(statusRows),
    };
  }

  private async buildOverviewPayload(
    storeId: number,
  ): Promise<MembersOverviewResponseDto> {
    return (
      (await queryMembersOverview(this.prisma, storeId)) ??
      buildEmptyMembersOverviewResponse()
    );
  }

  private async buildMemberResponse(
    member: MemberRecord,
  ): Promise<MemberResponseDto> {
    const rechargeRecords = await queryMemberRechargeHistory(
      this.prisma,
      member.id,
    );
    return toMemberResponse(member, rechargeRecords);
  }

  private resolvePagingBounds(): {
    defaultPageSize: number;
    maxPageSize: number;
  } {
    return {
      defaultPageSize:
        this.configService.get<number>('app.defaultPageSize') ?? 20,
      maxPageSize: this.configService.get<number>('app.maxPageSize') ?? 100,
    };
  }
}

/** 空页响应：meta 口径与迁移前一致，仅新增游标字段 */
function buildEmptyMembersPage(
  paging: MemberListPaging,
): PaginatedMembersResponseDto {
  return {
    items: [],
    meta: buildPaginationMeta(0, paging.page, paging.limit),
    hasMore: false,
    nextCursor: null,
  };
}
