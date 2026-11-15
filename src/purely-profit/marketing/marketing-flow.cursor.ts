// 营销流水（储值 / 退款 / 积分）游标分页：排序链 (createdAt, id) 的编解码、游标条件与到底判定
// （纯函数，不持有 IO 依赖）
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
} from '../../shared/cursor-pagination.utils';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
  type MarketingPaginationMeta,
} from './marketing.utils';

/**
 * 列表排序：两张流水表的 `created_at` 是 `TIMESTAMP(3)`，同一秒内连续办理的多笔
 * 储值/退款会拿到完全相同的毫秒值，必须以 `id` 兜底，否则同值行在游标翻页时会
 * 漏读或重复读。
 *
 * 该顺序与表上既有索引 `(store_id, created_at)` 的前两列同向（索引后向扫描即
 * DESC），`id` 不在索引内，同 `created_at` 分组由 Incremental Sort 补齐；分组通常
 * 只有 1~2 行，故不新增 `(store_id, created_at, id)` 索引（实测见交付说明）。
 */
export interface MarketingFlowCursor {
  createdAt: Date;
  id: number;
}

/** 流水列表分页参数归一结果 */
export interface MarketingFlowPaging {
  /** 页码：仅用于 meta 回填，游标路径下不再参与取数 */
  page: number;
  /** 实际生效的每页条数 */
  limit: number;
  /** 兼容期 offset：仅在未传 cursor 时生效 */
  offset: number;
  /** 游标：null 表示第一页或走 offset 兼容路径 */
  cursor: MarketingFlowCursor | null;
}

/** 编码列表游标（前端原样回传 nextCursor 即可） */
export const encodeMarketingFlowCursor = (row: {
  createdAt: Date;
  id: number;
}): string =>
  encodeCursor({
    keys: [row.createdAt.getTime()],
    id: row.id,
  });

/** 解码列表游标：空值视为第一页，格式非法由公共解码器抛 400 */
export const decodeMarketingFlowCursor = (
  raw?: string | null,
): MarketingFlowCursor | null => {
  const payload = decodeCursor(raw);
  if (!payload) {
    return null;
  }
  const [createdAtMs] = payload.keys;
  if (typeof createdAtMs !== 'number' || !Number.isSafeInteger(createdAtMs)) {
    throw new BadRequestException(CURSOR_INVALID_MESSAGE);
  }
  return {
    createdAt: new Date(createdAtMs),
    id: payload.id,
  };
};

/**
 * 分页参数归一：cursor 优先，缺省回退 page/pageSize（兼容期双路径并存）。
 *
 * 复用营销域既有的 `resolveMarketingPagination`，不另起一份分页实现：
 * offset 路径的 skip/take 与 meta 口径必须与迁移前逐字段一致。
 */
export const resolveMarketingFlowPaging = (query: {
  page?: number;
  pageSize?: number;
  cursor?: string;
}): MarketingFlowPaging => {
  const { page, skip, take } = resolveMarketingPagination(
    query.page,
    query.pageSize,
  );
  return {
    page,
    limit: take,
    offset: skip,
    cursor: decodeMarketingFlowCursor(query.cursor),
  };
};

/**
 * 游标条件：只保留严格排在游标之后的行。
 *
 * 用行值比较而不是 `a < x OR (a = x AND b < y)`：两者语义等价，但 OR 链无法被
 * Postgres 下推为索引条件，只能退化成「从门店区间顶部顺序扫描 + Filter」；
 * 行值比较可直接下推为 `Index Cond`，翻页深度不影响扫描起点。
 *
 * 列引用由调用方以静态 `Prisma.sql` 片段传入（表别名不同），不做字符串拼接。
 */
export const buildMarketingFlowCursorSql = (
  cursor: MarketingFlowCursor,
  columns: { createdAt: Prisma.Sql; id: Prisma.Sql },
): Prisma.Sql =>
  Prisma.sql`AND (${columns.createdAt}, ${columns.id}) < (${cursor.createdAt}, ${cursor.id})`;

/**
 * 与 SQL 行值比较同语义的谓词：`ORDER BY created_at DESC, id DESC` 下「严格排在
 * 游标之后」即「created_at 更早」或「created_at 相同且 id 更小」。
 *
 * 导出给单测做内存模拟，避免测试自行实现一套可能与 SQL 漂移的比较逻辑。
 */
export const isRowAfterMarketingFlowCursor = (
  row: { createdAt: Date; id: number },
  cursor: MarketingFlowCursor,
): boolean =>
  row.createdAt.getTime() === cursor.createdAt.getTime()
    ? row.id < cursor.id
    : row.createdAt.getTime() < cursor.createdAt.getTime();

/** 流水列表分页结果（尚未映射成响应 DTO） */
export interface MarketingFlowPage<TRow> {
  /** 已裁到本页条数的行：游标路径多取的探测行已被剔除 */
  rows: TRow[];
  meta: MarketingPaginationMeta;
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * 到底判定 + nextCursor 组装（两条路径共用的唯一出口）。
 *
 * - 游标路径：`take = limit + 1` 的探测行存在即说明还有下一页；游标取自本页最后一行。
 * - offset 路径：没有探测行，只能用 `offset + 已取条数 < total` 推导。
 *
 * 恒等式 `hasMore === (nextCursor !== null)` 由本函数单点保证，
 * 调用方不要再各自拼装，否则两条路径迟早漂移。
 */
export const buildMarketingFlowPage = <
  TRow extends { createdAt: Date; id: number },
>(
  rows: TRow[],
  total: number,
  paging: MarketingFlowPaging,
): MarketingFlowPage<TRow> => {
  const visibleRows = paging.cursor ? rows.slice(0, paging.limit) : rows;
  const hasMore = paging.cursor
    ? rows.length > paging.limit
    : paging.offset + rows.length < total;
  const lastRow = visibleRows.at(-1);

  return {
    rows: visibleRows,
    meta: buildMarketingPaginationMeta(total, paging.page, paging.limit),
    hasMore,
    nextCursor: hasMore && lastRow ? encodeMarketingFlowCursor(lastRow) : null,
  };
};
