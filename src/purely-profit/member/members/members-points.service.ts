import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AdjustMemberBeansDto,
  AdjustMemberBeansResponseDto,
  AdjustMemberPointsDto,
  AdjustMemberPointsResponseDto,
  ListMemberBeansLogsQueryDto,
  ListMemberPointsLogsQueryDto,
  MemberBeansOverviewResponseDto,
  MemberLogsOverviewQueryDto,
  MemberPointsOverviewResponseDto,
  PaginatedMemberBeansLogsResponseDto,
  PaginatedMemberPointsLogsResponseDto,
  type MemberBeanRecordSourceValue,
  type MemberBeanRecordTypeValue,
  type MemberPointsRecordSourceValue,
  type MemberPointsRecordTypeValue,
} from './dto/adjust-member-points.dto';
import type { MemberResponseDto } from './dto/member-response.dto';
import { MembersAccessService } from './members-access.service';
import { type MemberRecord, toMemberResponse } from './members.mapper';
import {
  toMemberBeansLogResponse,
  toMemberPointsLogResponse,
} from './members-points.mapper';
import {
  applyMemberBeansAdjustment,
  applyMemberPointsAdjustment,
  queryMemberBeanLogs,
  queryMemberBeansOverview,
  queryMemberPointsLogs,
  queryMemberPointsOverview,
} from './members-points.query';
import type {
  AdjustMemberAssetParams,
  MemberAssetAdjustmentInput,
  MemberAssetLogQueryParams,
  MemberAssetOverviewParams,
  MemberBeansOverviewRow,
  MemberPointsOverviewRow,
  ResolvedMemberAssetAdjustment,
} from './members.types';
import {
  buildPaginationMeta,
  parseMemberId,
  resolveAdjustmentDelta,
  resolvePagination,
} from './members.utils';

type PointsLogRecord = Parameters<typeof toMemberPointsLogResponse>[0];
type PointsLogResponse = ReturnType<typeof toMemberPointsLogResponse>;
type BeansLogRecord = Parameters<typeof toMemberBeansLogResponse>[0];
type BeansLogResponse = ReturnType<typeof toMemberBeansLogResponse>;

type MemberAssetListQuery<TType, TSource> = {
  storeId?: number;
  page?: number;
  pageSize?: number;
  type?: TType;
  source?: TSource;
  keyword?: string;
};

interface MemberAssetServiceConfig<
  TOverview,
  TType,
  TSource,
  TLog,
  TRecord,
  TApplyInput,
> {
  overviewForbiddenMessage: string;
  logsForbiddenMessage: string;
  emptyOverview: TOverview;
  overviewQuery: (
    prisma: PrismaService,
    storeId: number,
  ) => Promise<TOverview | null>;
  logsQuery: (
    prisma: PrismaService,
    params: {
      storeId: number;
      memberId?: number;
      skip: number;
      take: number;
      type?: TType;
      source?: TSource;
      keyword?: string;
    },
  ) => Promise<{ items: TLog[]; total: number }>;
  mapLog: (log: TLog) => TRecord;
  assetLabel: string;
  insufficientMessage: string;
  getCurrentValue: (member: MemberRecord) => number;
  buildApplyInput: (
    adjustment: ResolvedMemberAssetAdjustment,
  ) => TApplyInput;
  apply: (
    transaction: Prisma.TransactionClient,
    input: TApplyInput,
  ) => Promise<{ member: MemberRecord; log: TLog }>;
}

const POINTS_MEMBER_ASSET_CONFIG: MemberAssetServiceConfig<
  MemberPointsOverviewRow,
  MemberPointsRecordTypeValue,
  MemberPointsRecordSourceValue,
  PointsLogRecord,
  PointsLogResponse,
  Parameters<typeof applyMemberPointsAdjustment>[1]
> = {
  overviewForbiddenMessage: '无权查看该门店积分记录概览',
  logsForbiddenMessage: '无权查看该门店积分记录',
  emptyOverview: {
    totalCount: 0,
    adminAdjustCount: 0,
    todayChangeCount: 0,
  },
  overviewQuery: queryMemberPointsOverview,
  logsQuery: queryMemberPointsLogs,
  mapLog: toMemberPointsLogResponse,
  assetLabel: '积分',
  insufficientMessage: '会员当前积分不足，无法扣减',
  getCurrentValue: (member) => member.points,
  buildApplyInput: ({
    member,
    operatorStaffId,
    delta,
    reason,
    beforeValue,
    afterValue,
  }) => ({
    member,
    operatorStaffId,
    delta,
    reason,
    beforePoints: beforeValue,
    afterPoints: afterValue,
  }),
  apply: applyMemberPointsAdjustment,
};

const BEANS_MEMBER_ASSET_CONFIG: MemberAssetServiceConfig<
  MemberBeansOverviewRow,
  MemberBeanRecordTypeValue,
  MemberBeanRecordSourceValue,
  BeansLogRecord,
  BeansLogResponse,
  Parameters<typeof applyMemberBeansAdjustment>[1]
> = {
  overviewForbiddenMessage: '无权查看该门店纯利豆记录概览',
  logsForbiddenMessage: '无权查看该门店纯利豆记录',
  emptyOverview: {
    totalCount: 0,
    adminAdjustCount: 0,
    promoRewardCount: 0,
    withdrawCount: 0,
  },
  overviewQuery: queryMemberBeansOverview,
  logsQuery: queryMemberBeanLogs,
  mapLog: toMemberBeansLogResponse,
  assetLabel: '纯利豆',
  insufficientMessage: '会员当前纯利豆不足，无法扣减',
  getCurrentValue: (member) => member.beanBalance,
  buildApplyInput: ({
    member,
    operatorStaffId,
    delta,
    reason,
    beforeValue,
    afterValue,
  }) => ({
    member,
    operatorStaffId,
    delta,
    reason,
    beforeBalance: beforeValue,
    afterBalance: afterValue,
  }),
  apply: applyMemberBeansAdjustment,
};

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
    return this.getMemberAssetOverview(
      user,
      query,
      POINTS_MEMBER_ASSET_CONFIG,
    );
  }

  async listPointsLogs(
    user: AuthenticatedUser,
    query: ListMemberPointsLogsQueryDto,
  ): Promise<PaginatedMemberPointsLogsResponseDto> {
    return this.listMemberAssetLogs(user, query, POINTS_MEMBER_ASSET_CONFIG);
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
    );
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
    return this.listMemberAssetLogs(user, query, BEANS_MEMBER_ASSET_CONFIG);
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
    );
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

    return this.queryMemberAssetOverview({
      storeId,
      emptyOverview: config.emptyOverview,
      query: config.overviewQuery,
    });
  }

  private async listMemberAssetLogs<
    TType,
    TSource,
    TLog,
    TRecord,
    TApplyInput,
  >(
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
  ): Promise<{ items: TRecord[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const storeId = await this.resolveViewStoreId(
      user,
      query.storeId,
      config.logsForbiddenMessage,
    );

    return this.queryMemberAssetLogs({
      storeId,
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
      source: query.source,
      keyword: query.keyword,
      query: config.logsQuery,
      mapItem: config.mapLog,
    });
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
  ): Promise<{ items: TRecord[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const member = await this.membersAccessService.findManageableMemberOrThrow(
      user,
      memberId,
      'members:view',
    );

    return this.queryMemberAssetLogs({
      storeId: member.storeId,
      memberId: member.id,
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
      source: query.source,
      keyword: query.keyword,
      query: config.logsQuery,
      mapItem: config.mapLog,
    });
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

  private async queryMemberAssetOverview<TOverview>(
    params: MemberAssetOverviewParams<TOverview>,
  ): Promise<TOverview> {
    if (params.storeId === null) {
      return params.emptyOverview;
    }

    return (
      (await params.query(this.prisma, params.storeId)) ?? params.emptyOverview
    );
  }

  private async queryMemberAssetLogs<TType, TSource, TRow, TItem>(
    params: MemberAssetLogQueryParams<TType, TSource, TRow, TItem>,
  ): Promise<{ items: TItem[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const {
      storeId,
      memberId,
      page,
      pageSize,
      type,
      source,
      keyword,
      query,
      mapItem,
    } = params;
    const { page: currentPage, skip, take } = this.resolvePage(page, pageSize);

    if (storeId === null) {
      return {
        items: [],
        meta: buildPaginationMeta(0, currentPage, take),
      };
    }

    const { items, total } = await query(this.prisma, {
      storeId,
      memberId,
      skip,
      take,
      type,
      source,
      keyword,
    });

    return {
      items: items.map((item) => mapItem(item)),
      meta: buildPaginationMeta(total, currentPage, take),
    };
  }

  private async adjustMemberAsset<TLog, TRecord, TApplyInput>(
    params: AdjustMemberAssetParams<TLog, TRecord, TApplyInput>,
  ): Promise<{ user: MemberResponseDto; record: TRecord }> {
    const adjustment = await this.resolveMemberAssetAdjustment({
      user: params.user,
      input: params.input,
      memberId: params.memberId,
      assetLabel: params.assetLabel,
      getCurrentValue: params.getCurrentValue,
      insufficientMessage: params.insufficientMessage,
    });

    const result = await this.prisma.$transaction((transaction) =>
      params.apply(transaction, params.buildApplyInput(adjustment)),
    );

    return {
      user: toMemberResponse(result.member),
      record: params.mapRecord(result.log),
    };
  }

  private async resolveMemberAssetAdjustment(params: {
    user: AuthenticatedUser;
    input: MemberAssetAdjustmentInput;
    memberId?: number;
    assetLabel: string;
    getCurrentValue: (member: MemberRecord) => number;
    insufficientMessage: string;
  }): Promise<ResolvedMemberAssetAdjustment> {
    const resolvedMemberId =
      params.memberId ??
      parseMemberId(
        params.input.userId ?? params.input.memberId ?? params.input.id,
      );
    const delta = resolveAdjustmentDelta(params.input, params.assetLabel);
    const member = await this.membersAccessService.findManageableMemberOrThrow(
      params.user,
      resolvedMemberId,
      'members:update',
    );
    const operatorStaffId =
      await this.membersAccessService.findOperatorStaffIdForStore(
        params.user,
        member.storeId,
      );
    const beforeValue = params.getCurrentValue(member);
    const afterValue = beforeValue + delta;

    if (afterValue < 0) {
      throw new BadRequestException(params.insufficientMessage);
    }

    return {
      member,
      operatorStaffId,
      delta,
      reason: params.input.reason.trim(),
      beforeValue,
      afterValue,
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
