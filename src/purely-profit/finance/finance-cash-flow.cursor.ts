// 现金流水游标分页：排序链 (date, createdAt, id) 的编解码与条件构造（纯函数，不持有 IO 依赖）
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
} from '../../shared/cursor-pagination.utils';
import { buildPaginationState } from './finance-pagination.utils';
import type { FinanceCashFlowListQueryInput } from './finance.types';

/**
 * 列表排序：`date`（会计日期）与 `createdAt`（录入时间）都可能重复——
 * 同一天批量补录的流水 createdAt 常常相同，必须有 `id` 兜底，
 * 否则同值行在游标翻页时会漏读或重复读。
 *
 * 该顺序与表索引 `(storeId, date desc, createdAt desc, id desc)` 逐列同向匹配，
 * 游标条件可直接沿用索引的排序输出，不需要额外 sort。
 */
export const FINANCE_CASH_FLOW_ORDER_BY = [
  { date: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.FinanceCashFlowRecordOrderByWithRelationInput[];

/** 现金流水游标内容：与 FINANCE_CASH_FLOW_ORDER_BY 的排序键一一对应 */
export interface FinanceCashFlowListCursor {
  date: Date;
  createdAt: Date;
  id: number;
}

/** 现金流水分页参数归一结果 */
export interface FinanceCashFlowListPaging {
  /** 页码：仅用于 meta 回填，游标路径下不再参与取数 */
  page: number;
  /** 实际生效的每页条数 */
  limit: number;
  /** 兼容期 offset：仅在未传 cursor 时生效 */
  offset: number;
  /** 游标：null 表示第一页或走 offset 兼容路径 */
  cursor: FinanceCashFlowListCursor | null;
}

/** 编码列表游标（前端原样回传 nextCursor 即可） */
export const encodeFinanceCashFlowCursor = (row: {
  date: Date;
  createdAt: Date;
  id: number;
}): string =>
  encodeCursor({
    keys: [row.date.getTime(), row.createdAt.getTime()],
    id: row.id,
  });

/** 解码列表游标：空值视为第一页，格式非法由公共解码器抛 400 */
export const decodeFinanceCashFlowCursor = (
  raw?: string | null,
): FinanceCashFlowListCursor | null => {
  const payload = decodeCursor(raw);
  if (!payload) {
    return null;
  }
  const [dateMs, createdAtMs] = payload.keys;
  if (
    typeof dateMs !== 'number' ||
    !Number.isSafeInteger(dateMs) ||
    typeof createdAtMs !== 'number' ||
    !Number.isSafeInteger(createdAtMs)
  ) {
    throw new BadRequestException(CURSOR_INVALID_MESSAGE);
  }
  return {
    date: new Date(dateMs),
    createdAt: new Date(createdAtMs),
    id: payload.id,
  };
};

/**
 * 游标条件：只保留严格排在游标之后的行。
 *
 * 三个分支对应三级排序键，缺任何一级都会在同值时漏读：
 * `date` 相同但 `createdAt` 不同、两者都相同但 `id` 不同，必须逐级比较。
 */
export const buildFinanceCashFlowCursorWhere = (
  cursor: FinanceCashFlowListCursor,
): Prisma.FinanceCashFlowRecordWhereInput => ({
  OR: [
    { date: { lt: cursor.date } },
    { date: cursor.date, createdAt: { lt: cursor.createdAt } },
    { date: cursor.date, createdAt: cursor.createdAt, id: { lt: cursor.id } },
  ],
});

/**
 * 分页参数归一：cursor 优先，缺省回退 page/pageSize（兼容期双路径并存）。
 *
 * 复用财务域既有的 `buildPaginationState`：该模块历史上不对 pageSize 做二次钳制
 * （入口 DTO 已 @Max(100)），这里保持同一口径，避免迁移顺带改变
 * offset 路径的 skip/take 与列表缓存 key（key 里含 page/pageSize）。
 */
export const resolveFinanceCashFlowPaging = (
  query: FinanceCashFlowListQueryInput & { cursor?: string },
): FinanceCashFlowListPaging => {
  const { page, pageSize } = buildPaginationState(query.page, query.pageSize);
  return {
    page,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    cursor: decodeFinanceCashFlowCursor(query.cursor),
  };
};
