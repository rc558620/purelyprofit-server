// 销售记录列表游标分页：排序链 (date, id) 的编解码与条件构造（纯函数，不持有 IO 依赖）
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
} from '../../../shared/cursor-pagination.utils';
import { resolvePagination } from '../../commerce/commerce.utils';

/**
 * 列表排序：`date` 是业务销售时间，批量补录 / 同一时刻多笔下单会让它重复，
 * 必须以 `id` 兜底，否则同值行在游标翻页时会漏读或重复读。
 *
 * 该顺序与表索引 `(storeId, date desc, id desc)` 逐列同向匹配。
 * ⚠️ 报表 CSV 的 keyset 分批（`querySaleOrders` 的 `cursor: { id }` 分支）
 * 依赖同一份 orderBy，两边必须保持一致，否则导出会跳行或重复。
 */
export const SALES_RECORD_LIST_ORDER_BY = [
  { date: 'desc' },
  { id: 'desc' },
] satisfies Prisma.SaleOrderOrderByWithRelationInput[];

/** 销售记录列表游标内容：与 SALES_RECORD_LIST_ORDER_BY 的排序键一一对应 */
export interface SalesRecordListCursor {
  date: Date;
  id: number;
}

/** 销售记录列表分页参数归一结果 */
export interface SalesRecordListPaging {
  /** 页码：仅用于 meta 回填，游标路径下不再参与取数 */
  page: number;
  /** 实际生效的每页条数（已按上限钳制） */
  limit: number;
  /** 兼容期 offset：仅在未传 cursor 时生效 */
  offset: number;
  /** 游标：null 表示第一页或走 offset 兼容路径 */
  cursor: SalesRecordListCursor | null;
}

/** 编码列表游标（前端原样回传 nextCursor 即可） */
export const encodeSalesRecordListCursor = (row: {
  date: Date;
  id: number;
}): string => encodeCursor({ keys: [row.date.getTime()], id: row.id });

/** 解码列表游标：空值视为第一页，格式非法由公共解码器抛 400 */
export const decodeSalesRecordListCursor = (
  raw?: string | null,
): SalesRecordListCursor | null => {
  const payload = decodeCursor(raw);
  if (!payload) {
    return null;
  }
  const [dateMs] = payload.keys;
  if (
    typeof dateMs !== 'number' ||
    !Number.isSafeInteger(dateMs) ||
    dateMs <= 0
  ) {
    throw new BadRequestException(CURSOR_INVALID_MESSAGE);
  }
  return { date: new Date(dateMs), id: payload.id };
};

/**
 * 游标条件：只保留严格排在游标之后的行。
 *
 * 两个分支对应两级排序键：`date` 相同必须再比 `id`，否则同一时刻的多笔订单会漏读。
 */
export const buildSalesRecordListCursorWhere = (
  cursor: SalesRecordListCursor,
): Prisma.SaleOrderWhereInput => ({
  OR: [
    { date: { lt: cursor.date } },
    { date: cursor.date, id: { lt: cursor.id } },
  ],
});

/** 分页参数归一：cursor 优先，缺省回退 page/pageSize（兼容期双路径并存） */
export const resolveSalesRecordListPaging = (
  query: { page?: number; pageSize?: number; cursor?: string },
  options: { defaultPageSize: number; maxPageSize: number },
): SalesRecordListPaging => {
  // 复用既有归一逻辑：offset 路径的 page/skip/take 语义必须与迁移前逐字一致
  const { page, skip, take } = resolvePagination(
    query.page,
    query.pageSize,
    options.defaultPageSize,
    options.maxPageSize,
  );
  return {
    page,
    limit: take,
    offset: skip,
    cursor: decodeSalesRecordListCursor(query.cursor),
  };
};
