import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AdjustMemberBeansDto,
  AdjustMemberBeansResponseDto,
  ListMemberBeansLogsQueryDto,
  MemberBeansOverviewResponseDto,
  PaginatedMemberBeansLogsResponseDto,
} from './dto/member-beans.dto';
import { MemberLogsOverviewQueryDto } from './dto/member-asset-shared.dto';
import {
  AdjustMemberPointsDto,
  AdjustMemberPointsResponseDto,
  ListMemberPointsLogsQueryDto,
  MemberPointsOverviewResponseDto,
  PaginatedMemberPointsLogsResponseDto,
} from './dto/member-points.dto';
import type { MemberResponseDto } from './dto/member-response.dto';
import { MembersAccessService } from './members-access.service';
import { toMemberResponse } from './members.mapper';
import {
  BEANS_MEMBER_ASSET_CONFIG,
  POINTS_MEMBER_ASSET_CONFIG,
} from './members-points.config';
import {
  type MemberAssetListQuery,
  type MemberAssetListResponse,
  type MemberAssetPaginationConfig,
  type MemberAssetServiceConfig,
  queryMemberAssetLogs,
  queryMemberAssetOverview,
  resolveMemberAssetAdjustment,
} from './members-points.shared';
import type {
  AdjustMemberAssetParams,
  MemberAssetAdjustmentInput,
} from './members.types';

@Injectable()
export class MembersPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membersAccessService: MembersAccessService,
    private readonly configService: ConfigService,
  ) {}

  async getPointsOverview(
    user: AuthenticatedUser,
    query: MemberLogsOverviewQueryDto,
  ): Promise<MemberPointsOverviewResponseDto> {
    return this.getMemberAssetOverview(user, query, POINTS_MEMBER_ASSET_CONFIG);
  }

  async listPointsLogs(
    user: AuthenticatedUser,
    query: ListMemberPointsLogsQueryDto,
  ): Promise<PaginatedMemberPointsLogsResponseDto> {
    return this.listMemberAssetLogs(
      user,
      query,
      POINTS_MEMBER_ASSET_CONFIG,
    ) as Promise<PaginatedMemberPointsLogsResponseDto>;
  }

  async listPointsLogsForMember(
    user: AuthenticatedUser,
    memberId: number,
    query: ListMemberPointsLogsQueryDto,
  ): Promise<PaginatedMemberPointsLogsResponseDto> {
    return this.listMemberAssetLogsForMember(
      user,
      memberId,
      query,
      POINTS_MEMBER_ASSET_CONFIG,
    ) as Promise<PaginatedMemberPointsLogsResponseDto>;
  }

  async adjustPoints(
    user: AuthenticatedUser,
    dto: AdjustMemberPointsDto,
    memberId?: number,
  ): Promise<AdjustMemberPointsResponseDto> {
    return this.adjustMemberAssetByConfig(
      user,
      dto,
      memberId,
      POINTS_MEMBER_ASSET_CONFIG,
    );
  }

  async getBeansOverview(
    user: AuthenticatedUser,
    query: MemberLogsOverviewQueryDto,
  ): Promise<MemberBeansOverviewResponseDto> {
    return this.getMemberAssetOverview(user, query, BEANS_MEMBER_ASSET_CONFIG);
  }

  async listBeanLogs(
    user: AuthenticatedUser,
    query: ListMemberBeansLogsQueryDto,
  ): Promise<PaginatedMemberBeansLogsResponseDto> {
    return this.listMemberAssetLogs(
      user,
      query,
      BEANS_MEMBER_ASSET_CONFIG,
    ) as Promise<PaginatedMemberBeansLogsResponseDto>;
  }

  async listBeanLogsForMember(
    user: AuthenticatedUser,
    memberId: number,
    query: ListMemberBeansLogsQueryDto,
  ): Promise<PaginatedMemberBeansLogsResponseDto> {
    return this.listMemberAssetLogsForMember(
      user,
      memberId,
      query,
      BEANS_MEMBER_ASSET_CONFIG,
    ) as Promise<PaginatedMemberBeansLogsResponseDto>;
  }

  async adjustBeans(
    user: AuthenticatedUser,
    dto: AdjustMemberBeansDto,
    memberId?: number,
  ): Promise<AdjustMemberBeansResponseDto> {
    return this.adjustMemberAssetByConfig(
      user,
      dto,
      memberId,
      BEANS_MEMBER_ASSET_CONFIG,
    );
  }

  private async getMemberAssetOverview<
    TOverview,
    TType,
    TSource,
    TLog,
    TRecord,
    TApplyInput,
  >(
    user: AuthenticatedUser,
    query: MemberLogsOverviewQueryDto,
    config: MemberAssetServiceConfig<
      TOverview,
      TType,
      TSource,
      TLog,
      TRecord,
      TApplyInput
    >,
  ): Promise<TOverview> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      config.overviewForbiddenMessage,
    );

    return queryMemberAssetOverview(this.prisma, {
      storeId,
      emptyOverview: config.emptyOverview,
      query: config.overviewQuery,
    });
  }

  private async listMemberAssetLogs<TType, TSource, TLog, TRecord, TApplyInput>(
    user: AuthenticatedUser,
    query: MemberAssetListQuery<TType, TSource>,
    config: MemberAssetServiceConfig<
      unknown,
      TType,
      TSource,
      TLog,
      TRecord,
      TApplyInput
    >,
  ): Promise<MemberAssetListResponse<TRecord>> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      config.logsForbiddenMessage,
    );

    return queryMemberAssetLogs(
      this.prisma,
      {
        storeId,
        page: query.page,
        pageSize: query.pageSize,
        type: query.type,
        source: query.source,
        keyword: query.keyword,
        query: config.logsQuery,
        mapItem: config.mapLog,
      },
      this.getPaginationConfig(),
    );
  }

  private async listMemberAssetLogsForMember<
    TType,
    TSource,
    TLog,
    TRecord,
    TApplyInput,
  >(
    user: AuthenticatedUser,
    memberId: number,
    query: MemberAssetListQuery<TType, TSource>,
    config: MemberAssetServiceConfig<
      unknown,
      TType,
      TSource,
      TLog,
      TRecord,
      TApplyInput
    >,
  ): Promise<MemberAssetListResponse<TRecord>> {
    const member = await this.membersAccessService.findManageableMemberOrThrow(
      user,
      memberId,
      'members:view',
    );

    return queryMemberAssetLogs(
      this.prisma,
      {
        storeId: member.storeId,
        memberId: member.id,
        page: query.page,
        pageSize: query.pageSize,
        type: query.type,
        source: query.source,
        keyword: query.keyword,
        query: config.logsQuery,
        mapItem: config.mapLog,
      },
      this.getPaginationConfig(),
    );
  }

  private async adjustMemberAssetByConfig<
    TOverview,
    TType,
    TSource,
    TLog,
    TRecord,
    TApplyInput,
  >(
    user: AuthenticatedUser,
    dto: MemberAssetAdjustmentInput,
    memberId: number | undefined,
    config: MemberAssetServiceConfig<
      TOverview,
      TType,
      TSource,
      TLog,
      TRecord,
      TApplyInput
    >,
  ): Promise<{ user: MemberResponseDto; record: TRecord }> {
    return this.adjustMemberAsset({
      user,
      input: dto,
      memberId,
      assetLabel: config.assetLabel,
      insufficientMessage: config.insufficientMessage,
      getCurrentValue: config.getCurrentValue,
      buildApplyInput: config.buildApplyInput,
      apply: config.apply,
      mapRecord: config.mapLog,
    });
  }

  private async adjustMemberAsset<TLog, TRecord, TApplyInput>(
    params: AdjustMemberAssetParams<TLog, TRecord, TApplyInput>,
  ): Promise<{ user: MemberResponseDto; record: TRecord }> {
    const adjustment = await resolveMemberAssetAdjustment({
      user: params.user,
      input: params.input,
      memberId: params.memberId,
      assetLabel: params.assetLabel,
      getCurrentValue: params.getCurrentValue,
      insufficientMessage: params.insufficientMessage,
      resolveMember: (user, resolvedMemberId) =>
        this.membersAccessService.findManageableMemberOrThrow(
          user,
          resolvedMemberId,
          'members:update',
        ),
      resolveOperatorStaffId: (user, storeId) =>
        this.membersAccessService.findOperatorStaffIdForStore(user, storeId),
    });

    const result = await this.prisma.$transaction((transaction) =>
      params.apply(transaction, params.buildApplyInput(adjustment)),
    );

    return {
      user: toMemberResponse(result.member),
      record: params.mapRecord(result.log),
    };
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

  private getPaginationConfig(): MemberAssetPaginationConfig {
    return {
      defaultPageSize:
        this.configService.get<number>('app.defaultPageSize') ?? 20,
      maxPageSize: this.configService.get<number>('app.maxPageSize') ?? 100,
    };
  }
}
