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
    timezone: string,
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
  /** 调整前是否要求会员已关联营销顾客档案（积分需要，纯利豆不需要） */
  requiresCustomer: boolean;
  /** 未关联顾客档案时的清晰错误文案 */
  missingCustomerMessage: string;
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
  requiresCustomer: boolean;
  missingCustomerMessage: string;
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
  // 列表查询统一按日志表自身的 store_id（别名 l）过滤，与概览统计口径一致，
  // 避免会员迁店后出现“列表用会员当前门店、概览用日志创建时门店”的数量不一致。
  const filters: Prisma.Sql[] = [buildStoreIdWhereClause(params.storeId, 'l')];

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
  timezone: string,
  config: MemberAssetOverviewQueryConfig,
): Promise<TRow | null> {
  const rows = await prisma.$queryRaw<TRow[]>`
    SELECT ${config.selectSql(timezone)}
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

  return (
    (await params.query(prisma, params.storeId, params.timezone)) ??
    params.emptyOverview
  );
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
  // 路径参数（如 /members/:id/.../adjust）已携带会员 ID 时，无需再从 body 取标识；
  // 仅当路径未提供时，才强制要求 body 中的 userId/memberId/id（缺失属参数错误，返回 400）。
  let resolvedMemberId: number;
  if (params.memberId !== undefined) {
    resolvedMemberId = params.memberId;
  } else {
    const rawMemberId =
      params.input.userId ?? params.input.memberId ?? params.input.id;
    if (
      rawMemberId === undefined ||
      rawMemberId === null ||
      rawMemberId === ''
    ) {
      throw new BadRequestException(`请指定要调整的${params.assetLabel}会员`);
    }

    // 非法格式（如 "-1"、"abc"）也视为请求参数错误，统一返回 400
    try {
      resolvedMemberId = parseMemberId(rawMemberId);
    } catch {
      throw new BadRequestException(`请指定要调整的${params.assetLabel}会员`);
    }
  }

  const delta = resolveAdjustmentDelta(params.input, params.assetLabel);
  const member = await params.resolveMember(params.user, resolvedMemberId);

  // 积分事实源在 marketing_customers，要求会员必须已关联顾客档案
  if (params.requiresCustomer && member.customerId === null) {
    throw new BadRequestException(params.missingCustomerMessage);
  }

  const operatorStaffId = await params.resolveOperatorStaffId(
    params.user,
    member.storeId,
  );

  const expireAt =
    params.input.expireAt !== undefined
      ? new Date(params.input.expireAt)
      : undefined;

  return {
    member,
    operatorStaffId,
    delta,
    reason: params.input.reason.trim(),
    expireAt,
    idempotencyKey: params.input.idempotencyKey,
  };
}
