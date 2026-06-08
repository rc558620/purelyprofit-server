import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildMembersListCacheKey,
  buildMembersMetaCacheKey,
  buildMembersOverviewCacheKey,
} from '../../../redis/keys';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisService } from '../../../redis/redis.service';
import { CreateMemberDto } from './dto/create-member.dto';
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
import { UpdateMemberDto } from './dto/update-member.dto';
import { MembersAccessService } from './members-access.service';
import {
  buildEmptyMembersOverviewResponse,
  buildMemberLevelMetaRows,
  buildMemberStatusMetaRows,
  prepareMemberCreateInput,
  prepareMemberUpdateInput,
} from './members.domain';
import { type MemberRecord, toMemberResponse } from './members.mapper';
import { toMemberSnapshotResponses } from './members.snapshot.mapper';
import {
  deleteMemberRecord,
  insertMemberRecord,
  queryMemberRechargeHistory,
  queryMemberSnapshots,
  queryMembersMeta,
  queryMembersOverview,
  queryMembersPage,
  replaceMemberRechargeHistory,
  updateMemberRecord,
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
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membersAccessService: MembersAccessService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateMemberDto,
  ): Promise<MemberResponseDto> {
    await this.membersAccessService.ensureCanManageMembers(
      user,
      dto.storeId,
      'members:create',
    );

    const prepared = prepareMemberCreateInput(dto.storeId, dto.name, {
      phone: dto.phone,
      gender: dto.gender,
      level: dto.level,
      status: dto.status,
      remark: dto.remark,
      birthday: dto.birthday,
      lastActiveAt: dto.lastActiveAt,
      availablePoints: dto.availablePoints,
      totalPointsEarned: dto.totalPointsEarned,
      beanBalance: dto.beanBalance,
      isPartner: dto.isPartner,
      partnerLevel: dto.partnerLevel,
      totalRecharged: dto.totalRecharged,
      rechargeCount: dto.rechargeCount,
      invitedCount: dto.invitedCount,
      rechargeHistory: dto.rechargeHistory,
      bannedReason: dto.bannedReason,
    });
    await this.ensurePhoneUnique(dto.storeId, prepared.phone ?? undefined);

    const operatorStaffId =
      prepared.rechargeHistory.length > 0
        ? await this.membersAccessService.findOperatorStaffIdForStore(
            user,
            dto.storeId,
          )
        : null;

    const member = await this.prisma.$transaction(async (transaction) => {
      const createdMember = await insertMemberRecord(transaction, prepared);

      if (prepared.rechargeHistory.length > 0) {
        await replaceMemberRechargeHistory(transaction, {
          memberId: createdMember.id,
          storeId: createdMember.storeId,
          rechargeHistory: prepared.rechargeHistory,
          operatorStaffId,
        });
      }

      return createdMember;
    });

    await this.invalidateMembersDerived(member.storeId);
    return this.buildMemberResponse(member);
  }

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

    return this.redisService.getOrLoadRefreshableJson({
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
    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MEMBERS_META_CACHE_TTL_SECONDS,
      refreshAfterMs: MEMBERS_META_REFRESH_AFTER_MS,
      loadValue: async () => {
        const { levelRows, statusRows } = await queryMembersMeta(
          this.prisma,
          storeId,
        );

        return {
          levels: buildMemberLevelMetaRows(levelRows),
          statuses: buildMemberStatusMetaRows(statusRows),
        };
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
    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MEMBERS_OVERVIEW_CACHE_TTL_SECONDS,
      refreshAfterMs: MEMBERS_OVERVIEW_REFRESH_AFTER_MS,
      loadValue: async () =>
        (await queryMembersOverview(this.prisma, storeId)) ??
        buildEmptyMembersOverviewResponse(),
    });
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

  async update(
    user: AuthenticatedUser,
    memberId: number,
    dto: UpdateMemberDto,
  ): Promise<MemberResponseDto> {
    const existingMember =
      await this.membersAccessService.findManageableMemberOrThrow(
        user,
        memberId,
        'members:update',
      );
    const prepared = prepareMemberUpdateInput(existingMember, {
      name: dto.name,
      phone: dto.phone,
      gender: dto.gender,
      level: dto.level,
      status: dto.status,
      remark: dto.remark,
      birthday: dto.birthday,
      lastActiveAt: dto.lastActiveAt,
      availablePoints: dto.availablePoints,
      totalPointsEarned: dto.totalPointsEarned,
      beanBalance: dto.beanBalance,
      isPartner: dto.isPartner,
      partnerLevel: dto.partnerLevel,
      totalRecharged: dto.totalRecharged,
      rechargeCount: dto.rechargeCount,
      invitedCount: dto.invitedCount,
      rechargeHistory: dto.rechargeHistory,
      bannedReason: dto.bannedReason,
    });

    await this.ensurePhoneUnique(
      existingMember.storeId,
      prepared.normalizedPhone,
      existingMember.id,
    );

    if (
      prepared.assignments.length === 0 &&
      prepared.rechargeHistory === undefined
    ) {
      return this.buildMemberResponse(existingMember);
    }

    const operatorStaffId =
      prepared.rechargeHistory !== undefined
        ? await this.membersAccessService.findOperatorStaffIdForStore(
            user,
            existingMember.storeId,
          )
        : null;

    const member = await this.prisma.$transaction(async (transaction) => {
      const updatedMember =
        prepared.assignments.length > 0
          ? await updateMemberRecord(
              transaction,
              existingMember.id,
              prepared.assignments,
            )
          : existingMember;

      if (prepared.rechargeHistory !== undefined) {
        await replaceMemberRechargeHistory(transaction, {
          memberId: updatedMember.id,
          storeId: updatedMember.storeId,
          rechargeHistory: prepared.rechargeHistory,
          operatorStaffId,
        });
      }

      return updatedMember;
    });

    await this.invalidateMembersDerived(member.storeId);
    return this.buildMemberResponse(member);
  }

  async remove(user: AuthenticatedUser, memberId: number): Promise<void> {
    const existingMember =
      await this.membersAccessService.findManageableMemberOrThrow(
        user,
        memberId,
        'members:update',
      );

    await deleteMemberRecord(this.prisma, existingMember.id);
    await this.invalidateMembersDerived(existingMember.storeId);
  }

  private async invalidateMembersDerived(storeId: number): Promise<void> {
    await this.cacheInvalidatorService.invalidateMembersDerived(storeId);
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

  private async ensurePhoneUnique(
    storeId: number,
    phone?: string,
    excludeMemberId?: number,
  ): Promise<void> {
    if (phone === undefined) {
      return;
    }

    const existingMember = await this.prisma.member.findFirst({
      where: {
        storeId,
        phone,
        ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
      },
      select: { id: true },
    });

    if (existingMember) {
      throw new ConflictException('该门店下会员手机号已存在');
    }
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
