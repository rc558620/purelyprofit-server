// 成本记录游标分页：排序链 (date, createdAt, id) 的编解码与条件构造（纯函数，不持有 IO 依赖）
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
} from '../../../shared/cursor-pagination.utils';
import { resolvePagination } from '../../commerce/commerce.utils';
import type { ListCostRecordsQueryDto } from './dto/costs-query.dto';

/** 成本记录默认每页条数：沿用迁移前的默认值 */
export const COST_RECORD_DEFAULT_PAGE_SIZE = 20;

/**
 * 列表排序：`date`（会计日期）与 `createdAt` 都可能重复（同一天批量录入），
 * 必须以 `id` 兜底，否则同值行在游标翻页时会漏读或重复读。
 */
export const COST_RECORD_ORDER_BY = [
  { date: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.CostRecordOrderByWithRelationInput[];

/** 成本记录游标内容：与 COST_RECORD_ORDER_BY 的排序键一一对应 */
export interface CostRecordCursor {
  date: Date;
  createdAt: Date;
  id: number;
}

/** 成本记录分页参数归一结果 */
export interface CostRecordPaging {
  /** 页码：仅用于 meta 回填，游标路径下不再参与取数 */
  page: number;
  /** 实际生效的每页条数（已按上限钳制） */
  limit: number;
  /** 兼容期 offset：仅在未传 cursor 时生效 */
  offset: number;
  /** 游标：null 表示第一页或走 offset 兼容路径 */
  cursor: CostRecordCursor | null;
}

/** 编码列表游标（前端原样回传 nextCursor 即可） */
export const encodeCostRecordCursor = (row: {
  date: Date;
  createdAt: Date;
  id: number;
}): string =>
  encodeCursor({
    keys: [row.date.getTime(), row.createdAt.getTime()],
    id: row.id,
  });

/** 解码列表游标：空值视为第一页，格式非法由公共解码器抛 400 */
export const decodeCostRecordCursor = (
  raw?: string | null,
): CostRecordCursor | null => {
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
export const buildCostRecordCursorWhere = (
  cursor: CostRecordCursor,
): Prisma.CostRecordWhereInput => ({
  OR: [
    { date: { lt: cursor.date } },
    { date: cursor.date, createdAt: { lt: cursor.createdAt } },
    { date: cursor.date, createdAt: cursor.createdAt, id: { lt: cursor.id } },
  ],
});

/** 分页参数归一：cursor 优先，缺省回退 page/pageSize（兼容期双路径并存） */
export const resolveCostRecordPaging = (
  query: ListCostRecordsQueryDto,
  maxPageSize: number,
): CostRecordPaging => {
  // 复用既有归一逻辑：offset 路径的 page/skip/take 语义必须与迁移前逐字一致
  const { page, skip, take } = resolvePagination(
    query.page,
    query.pageSize,
    COST_RECORD_DEFAULT_PAGE_SIZE,
    maxPageSize,
  );
  return {
    page,
    limit: take,
    offset: skip,
    cursor: decodeCostRecordCursor(query.cursor),
  };
};
