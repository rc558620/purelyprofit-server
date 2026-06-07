import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MemberRecord } from './members.mapper';
import type {
  CountRow,
  MemberAssetAdjustmentInput,
  MemberAssetLogQueryParams,
  MemberAssetLogsQueryConfig,
  MemberAssetLogsWhereClauseConfig,
  MemberAssetOverviewParams,
  MemberAssetOverviewQueryConfig,
  QueryMemberAssetLogsInput,
  ResolvedMemberAssetAdjustment,
} from './members.types';
import {
  buildPaginationMeta,
  parseMemberId,
  resolveAdjustmentDelta,
  resolvePagination,
} from './members.utils';
import { buildStoreIdWhereClause } from './members-query.shared';

export type MemberAssetListQuery<TType, TSource> = {
  storeId?: number;
  page?: number;
  pageSize?: number;
  type?: TType;
  source?: TSource;
  keyword?: string;
};

export interface MemberAssetServiceConfig<
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
  buildApplyInput: (adjustment: ResolvedMemberAssetAdjustment) => TApplyInput;
  apply: (
    transaction: Prisma.TransactionClient,
    input: TApplyInput,
  ) => Promise<{ member: MemberRecord; log: TLog }>;
}

export interface MemberAssetPaginationConfig {
  defaultPageSize: number;
  maxPageSize: number;
}

export interface MemberAssetListResponse<TItem> {
  items: TItem[];
  meta: ReturnType<typeof buildPaginationMeta>;
}

interface ResolveMemberAssetAdjustmentParams {
  user: AuthenticatedUser;
  input: MemberAssetAdjustmentInput;
  memberId?: number;
  assetLabel: string;
  insufficientMessage: string;
  getCurrentValue: (member: MemberRecord) => number;
  resolveMember: (
    user: AuthenticatedUser,
    memberId: number,
  ) => Promise<MemberRecord>;
  resolveOperatorStaffId: (
    user: AuthenticatedUser,
    storeId: number,
  ) => Promise<number | null>;
}

function buildMemberAssetLogsWhereClause<TType, TSource>(
  params: QueryMemberAssetLogsInput<TType, TSource>,
  config: MemberAssetLogsWhereClauseConfig<TType, TSource>,
): Prisma.Sql {
  const filters: Prisma.Sql[] = [buildStoreIdWhereClause(params.storeId)];

  if (params.memberId) {
    filters.push(Prisma.sql`l.member_id = ${params.memberId}`);
  }

  filters.push(...config.buildTypeFilters(params.type));

  if (params.source) {
    filters.push(config.buildSourceFilter(params.source));
  }

  if (params.keyword) {
    filters.push(config.buildKeywordFilter(params.keyword));
  }

  return Prisma.join(filters, ' AND ');
}

export function createMemberAssetLogsQueryConfig<TType, TSource>(params: {
  selectSql: Prisma.Sql;
  fromSql: Prisma.Sql;
  whereClause: MemberAssetLogsWhereClauseConfig<TType, TSource>;
}): MemberAssetLogsQueryConfig<TType, TSource> {
  return {
    selectSql: params.selectSql,
    fromSql: params.fromSql,
    buildWhereClause: (
      queryParams: QueryMemberAssetLogsInput<TType, TSource>,
    ) => buildMemberAssetLogsWhereClause(queryParams, params.whereClause),
  };
}

export async function queryConfiguredMemberAssetOverview<TRow>(
  prisma: PrismaService,
  storeId: number,
  config: MemberAssetOverviewQueryConfig,
): Promise<TRow | null> {
  const rows = await prisma.$queryRaw<TRow[]>`
    SELECT ${config.selectSql}
    ${config.fromSql}
    WHERE store_id = ${storeId}
  `;

  return rows[0] ?? null;
}

export async function queryConfiguredMemberAssetLogs<TType, TSource, TRow>(
  prisma: PrismaService,
  params: QueryMemberAssetLogsInput<TType, TSource>,
  config: MemberAssetLogsQueryConfig<TType, TSource>,
): Promise<{ items: TRow[]; total: number }> {
  const whereClause = config.buildWhereClause(params);
  const [items, countRows] = await Promise.all([
    prisma.$queryRaw<TRow[]>`
      SELECT ${config.selectSql}
      ${config.fromSql}
      WHERE ${whereClause}
      ORDER BY l.created_at DESC, l.id DESC
      OFFSET ${params.skip}
      LIMIT ${params.take}
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS count
      ${config.fromSql}
      WHERE ${whereClause}
    `,
  ]);

  return {
    items,
    total: countRows[0]?.count ?? 0,
  };
}

export async function queryMemberAssetOverview<TOverview>(
  prisma: PrismaService,
  params: MemberAssetOverviewParams<TOverview>,
): Promise<TOverview> {
  if (params.storeId === null) {
    return params.emptyOverview;
  }

  return (await params.query(prisma, params.storeId)) ?? params.emptyOverview;
}

export async function queryMemberAssetLogs<TType, TSource, TRow, TItem>(
  prisma: PrismaService,
  params: MemberAssetLogQueryParams<TType, TSource, TRow, TItem>,
  paginationConfig: MemberAssetPaginationConfig,
): Promise<MemberAssetListResponse<TItem>> {
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
  const {
    page: currentPage,
    skip,
    take,
  } = resolvePagination(
    page,
    pageSize,
    paginationConfig.defaultPageSize,
    paginationConfig.maxPageSize,
  );

  if (storeId === null) {
    return {
      items: [],
      meta: buildPaginationMeta(0, currentPage, take),
    };
  }

  const { items, total } = await query(prisma, {
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

export async function resolveMemberAssetAdjustment(
  params: ResolveMemberAssetAdjustmentParams,
): Promise<ResolvedMemberAssetAdjustment> {
  const resolvedMemberId =
    params.memberId ??
    parseMemberId(
      params.input.userId ?? params.input.memberId ?? params.input.id,
    );
  const delta = resolveAdjustmentDelta(params.input, params.assetLabel);
  const member = await params.resolveMember(params.user, resolvedMemberId);
  const operatorStaffId = await params.resolveOperatorStaffId(
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
