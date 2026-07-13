import { ConflictException, Injectable, Logger } from '@nestjs/common';
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
  ResolvedMemberAssetAdjustment,
} from './members.types';

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
    await this.guardDuplicateAdjustment(params.assetLabel, adjustment);

    const result = await this.prisma.$transaction((transaction) =>
      params.apply(transaction, params.buildApplyInput(adjustment)),
    );

    await this.cacheInvalidatorService.invalidateMembersDerived(
      result.member.storeId,
    );

    return {
      user: toMemberResponse(result.member),
      record: params.mapRecord(result.log),
    };
  }

  /**
   * 资产调整防重复提交守卫。
   * 基于「门店 + 会员 + 资产类型 + 金额 + 原因 + 操作人 + 幂等键/过期时间」指纹做 Redis 去重。
   * - 加入 operatorStaffId：避免不同管理员对同会员同金额同原因的合法调整被误判为重复。
   * - 若客户端传入 idempotencyKey，则以该键作为去重依据（每次请求唯一），彻底避免误伤；
   *   未传时回退到 expireAt（纯利豆无过期时间，退化为空串，仅作内容级兜底）。
   * Redis 不可用时降级放行（幂等性由 DB 原子相对更新兜底），不阻断正常调整。
   */
  private async guardDuplicateAdjustment(
    assetLabel: string,
    adjustment: ResolvedMemberAssetAdjustment,
  ): Promise<void> {
    const dedupSignal =
      adjustment.idempotencyKey ?? adjustment.expireAt?.getTime() ?? '';
    const fingerprint = [
      'member-asset',
      'adjust',
      adjustment.member.storeId,
      adjustment.member.id,
      assetLabel,
      adjustment.delta,
      adjustment.reason,
      adjustment.operatorStaffId ?? '',
      dedupSignal,
    ].join(':');

    try {
      const acquired = await this.redisService.setIfAbsent(
        fingerprint,
        '1',
        60,
      );
      if (!acquired) {
        throw new ConflictException('请勿重复提交资产调整');
      }
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.warn(
        `[member-asset] 幂等校验跳过（Redis 不可用）: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
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
