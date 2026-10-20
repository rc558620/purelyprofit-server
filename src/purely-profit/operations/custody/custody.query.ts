// 客存 Prisma 查询构造：列表筛选、游标分页与排序集中于此，service 只做编排
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CUSTODY_EXPIRING_SOON_DAYS } from './custody.constants';
import type {
  CustodyCursorContext,
  CustodyListParams,
  CustodyListQuery,
} from './custody.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 列表支持的筛选状态（含 all） */
const FILTERABLE_STATUSES = [
  'draft',
  'stored',
  'finished',
  'expired',
  'void',
] as const;

/** 游标正则：`{createdAtMs}_{id}` */
const CURSOR_PATTERN = /^(\d{10,13})_(\d+)$/;

/** 是否为合法的列表状态筛选值 */
export function isSupportedStatusFilter(value: string): boolean {
  return value === 'all' || FILTERABLE_STATUSES.some((item) => item === value);
}

/** 编排游标：毫秒时间戳 + 主键，保证排序键稳定唯一 */
export function encodeCursor(record: { createdAt: Date; id: number }): string {
  return `${record.createdAt.getTime()}_${record.id}`;
}

/** 解析游标，格式非法时抛出参数异常 */
export function decodeCursor(rawCursor: string): CustodyCursorContext {
  const matched = CURSOR_PATTERN.exec(rawCursor);
  if (!matched) {
    throw new BadRequestException('cursor 格式不合法');
  }
  const createdAtMs = Number(matched[1]);
  const id = Number(matched[2]);
  if (
    !Number.isSafeInteger(createdAtMs) ||
    !Number.isSafeInteger(id) ||
    id <= 0
  ) {
    throw new BadRequestException('cursor 格式不合法');
  }
  return { createdAt: new Date(createdAtMs), id };
}

/** 构建列表查询条件（含游标条件与临期/过期的时间语义） */
export function buildListQuery(
  params: CustodyListParams,
  now: Date,
): CustodyListQuery {
  const conditions = buildFilterConditions(params, now);
  if (params.cursor) {
    conditions.push(buildCursorCondition(decodeCursor(params.cursor)));
  }

  return {
    where: { AND: conditions },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
  };
}

/**
 * 构建总条数的查询条件：与列表同筛选，但**不含游标**。
 *
 * 总条数是全量口径。带上游标条件后，翻到第 N 页时总数会跟着游标一路变小，
 * 前端拿到的就不再是一个稳定值；去掉游标后总数还可按筛选组合缓存。
 */
export function buildCountWhere(
  params: CustodyListParams,
  now: Date,
): Prisma.CustodyOrderWhereInput {
  return { AND: buildFilterConditions(params, now) };
}

/** 构建列表与总条数共用的筛选条件（不含游标） */
function buildFilterConditions(
  params: CustodyListParams,
  now: Date,
): Prisma.CustodyOrderWhereInput[] {
  // 用 AND 数组拼装：状态条件与关键字条件都可能带 OR，直接展开会互相覆盖
  const conditions: Prisma.CustodyOrderWhereInput[] = [
    { storeId: params.storeId, deletedAt: null },
  ];
  // 到期预警查询忽略状态 Tab：直接取在存且临期阈值内到期（含已到期）的存单
  if (params.expiring) {
    const expiringEdge = new Date(
      now.getTime() + CUSTODY_EXPIRING_SOON_DAYS * DAY_MS,
    );
    conditions.push({
      status: 'stored',
      expireAt: { not: null, lte: expiringEdge },
    });
  } else {
    const statusCondition = buildStatusCondition(params.status, now);
    if (Object.keys(statusCondition).length > 0) {
      conditions.push(statusCondition);
    }
  }
  const keywordCondition = buildKeywordCondition(params.keyword);
  if (Object.keys(keywordCondition).length > 0) {
    conditions.push(keywordCondition);
  }

  return conditions;
}

/** 构建详情查询条件 */
export function buildDetailWhere(
  storeId: number,
  orderId: number,
): Prisma.CustodyOrderWhereInput {
  return { id: orderId, storeId, deletedAt: null };
}

/** 构建取出流水查询条件 */
export function buildPickupWhere(
  custodyOrderId: number,
): Prisma.CustodyPickupWhereInput {
  return { custodyOrderId, deletedAt: null };
}

/**
 * 状态条件：expired 为惰性派生状态，DB 不落库；
 * stored 需排除已到期记录，expired 则取 stored 且已到期的记录。
 */
function buildStatusCondition(
  status: string,
  now: Date,
): Prisma.CustodyOrderWhereInput {
  switch (status) {
    case 'stored':
      return {
        status: 'stored',
        OR: [{ expireAt: null }, { expireAt: { gt: now } }],
      };
    case 'expired':
      return { status: 'stored', expireAt: { not: null, lte: now } };
    case 'draft':
    case 'finished':
    case 'void':
      return { status: status as Prisma.EnumCustodyStatusFilter['equals'] };
    default:
      return {};
  }
}

/**
 * 关键字条件：会员姓名/手机号快照/商品名/存放位置。
 *
 * 统一走 insensitive（生成 ILIKE）：店员在小键盘/中文输入法下随手敲出的
 * 大小写并不规范，默认的 contains 在 PostgreSQL 是大小写敏感的 LIKE，
 * 会出现「输入小写搜不到大写会员名」这种看起来像没数据的问题。
 *
 * 注意 `%kw%` 的前后通配走不了 B-tree：单店存单量级到几十万行且搜索变慢时，
 * 应在这些列上补 pg_trgm 的 GIN 索引（Prisma 不表达，需手写迁移）。
 */
function buildKeywordCondition(keyword: string): Prisma.CustodyOrderWhereInput {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return {};
  }
  return {
    OR: [
      { memberNameSnapshot: { contains: trimmed, mode: 'insensitive' } },
      { memberPhoneSnapshot: { contains: trimmed, mode: 'insensitive' } },
      { productName: { contains: trimmed, mode: 'insensitive' } },
      { location: { contains: trimmed, mode: 'insensitive' } },
    ],
  };
}

/** 游标条件：`(createdAt < c) OR (createdAt = c AND id < i)` */
function buildCursorCondition(
  cursor: CustodyCursorContext,
): Prisma.CustodyOrderWhereInput {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}
