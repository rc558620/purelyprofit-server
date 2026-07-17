import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildMembersListCacheKey,
  buildMembersMetaCacheKey,
  buildMembersOverviewCacheKey,
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
  queryMemberRechargeHistory,
  queryMemberSnapshots,
  queryMembersMeta,
  queryMembersOverview,
  queryMembersPage,
} from './members.query';
import {
  buildPaginationMeta,
  resolvePagination,
  toDbMemberStatus,
} from './members.utils';

const MEMBERS_LIST_CACHE_TTL_SECONDS = 90;
const MEMBERS_LIST_REFRESH_AFTER_MS = 20_000;
const MEMBERS_META_CACHE_TTL_SECONDS = 300;
const MEMBERS_META_REFRESH_AFTER_MS = 60_000;
const MEMBERS_OVERVIEW_CACHE_TTL_SECONDS = 120;
const MEMBERS_OVERVIEW_REFRESH_AFTER_MS = 30_000;

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
    const {
      page: currentPage,
      skip,
      take,
    } = this.resolvePage(query.page, query.pageSize);

    if (storeId === null) {
      return {
        items: [],
        meta: buildPaginationMeta(0, currentPage, take),
      };
    }

    const cacheKey = buildMembersListCacheKey(storeId, {
      status: query.status,
      level: query.level,
      keyword: query.keyword,
      partner: query.partner,
      page: currentPage,
      pageSize: take,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MEMBERS_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: MEMBERS_LIST_REFRESH_AFTER_MS,
      loadValue: async () => {
        const { items, total } = await queryMembersPage(this.prisma, {
          storeId,
          status: toDbMemberStatus(query.status),
          level: query.level,
          keyword: query.keyword,
          onlyPartners: query.partner,
          skip,
          take,
        });

        return {
          items: items.map((item) => toMemberResponse(item)),
          meta: buildPaginationMeta(total, currentPage, take),
        };
      },
    });
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
      return {
        levels: [],
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

    const rows = await queryMemberSnapshots(this.prisma, {
      storeId,
      keyword: query.keyword,
      onlyPartners: query.onlyPartners,
    });

    return toMemberSnapshotResponses(rows);
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

  private resolvePage(
    page?: number,
    pageSize?: number,
  ): { page: number; skip: number; take: number } {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;

    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
