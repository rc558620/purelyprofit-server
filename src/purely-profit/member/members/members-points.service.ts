import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisService } from '../../../redis/redis.service';
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
import { queryMemberRechargeHistory } from './members.query';
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
import { guardDuplicateMemberAssetAdjustment } from './members-points-dedup.shared';

@Injectable()
export class MembersPointsService {
  private readonly logger = new Logger(MembersPointsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly membersAccessService: MembersAccessService,
    private readonly configService: ConfigService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly redisService: RedisService,
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

    const businessTimezone =
      this.configService.get<string>('app.businessTimezone') ?? 'Asia/Shanghai';

    return queryMemberAssetOverview(this.prisma, {
      storeId,
      emptyOverview: config.emptyOverview,
      query: config.overviewQuery,
      timezone: businessTimezone,
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
        // 会员维度：不叠加门店条件，只看 member_id。
        // 日志的 store_id 是建流水时的门店，会员迁店后按当前门店过滤会丢历史。
        storeId: null,
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
      requiresCustomer: config.requiresCustomer,
      missingCustomerMessage: config.missingCustomerMessage,
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
      insufficientMessage: params.insufficientMessage,
      requiresCustomer: params.requiresCustomer,
      missingCustomerMessage: params.missingCustomerMessage,
      resolveMember: (user, resolvedMemberId) =>
        this.membersAccessService.findManageableMemberOrThrow(
          user,
          resolvedMemberId,
          'members:update',
        ),
      resolveOperatorStaffId: (user, storeId) =>
        this.membersAccessService.findOperatorStaffIdForStore(user, storeId),
    });

    // 防重复提交：相同会员 + 资产 + 金额 + 原因 + 过期时间指纹在 60s 内去重
    await guardDuplicateMemberAssetAdjustment(
      { redisService: this.redisService, logger: this.logger },
      params.assetLabel,
      adjustment,
    );

    const result = await this.prisma.$transaction((transaction) =>
      params.apply(transaction, params.buildApplyInput(adjustment)),
    );

    await this.cacheInvalidatorService.invalidateMembersDerived(
      result.member.storeId,
    );

    // 与详情/列表口径一致：带回充值记录，避免前端用返回值覆盖状态时丢掉充值历史
    const rechargeRecords = await queryMemberRechargeHistory(
      this.prisma,
      result.member.id,
    );

    return {
      user: toMemberResponse(result.member, rechargeRecords),
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
