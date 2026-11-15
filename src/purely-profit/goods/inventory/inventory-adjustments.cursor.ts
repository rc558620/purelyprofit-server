// 库存流水游标分页：排序链 (created_at, id) 的编解码与原生 SQL 条件片段（纯函数）
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
} from '../../../shared/cursor-pagination.utils';
import { resolvePagination } from '../../commerce/commerce.utils';
import type { InventoryAdjustmentsListQueryInput } from './inventory.types';

/** 库存流水游标内容：与 `ORDER BY created_at DESC, id DESC` 一一对应 */
export interface InventoryAdjustmentCursor {
  createdAt: Date;
  id: number;
}

/** 库存流水分页参数归一结果 */
export interface InventoryAdjustmentPaging {
  /** 页码：仅用于 meta 回填，游标路径下不再参与取数 */
  page: number;
  /** 实际生效的每页条数（已按上限钳制） */
  limit: number;
  /** 兼容期 offset：仅在未传 cursor 时生效 */
  offset: number;
  /** 游标：null 表示第一页或走 offset 兼容路径 */
  cursor: InventoryAdjustmentCursor | null;
}

/** 编码列表游标（前端原样回传 nextCursor 即可） */
export const encodeInventoryAdjustmentCursor = (row: {
  createdAt: Date;
  id: number;
}): string => encodeCursor({ keys: [row.createdAt.getTime()], id: row.id });

/** 解码列表游标：空值视为第一页，格式非法由公共解码器抛 400 */
export const decodeInventoryAdjustmentCursor = (
  raw?: string | null,
): InventoryAdjustmentCursor | null => {
  const payload = decodeCursor(raw);
  if (!payload) {
    return null;
  }
  const [createdAtMs] = payload.keys;
  if (
    typeof createdAtMs !== 'number' ||
    !Number.isSafeInteger(createdAtMs) ||
    createdAtMs <= 0
  ) {
    throw new BadRequestException(CURSOR_INVALID_MESSAGE);
  }
  return { createdAt: new Date(createdAtMs), id: payload.id };
};

/**
 * 游标条件（原生 SQL 片段）：只保留严格排在游标之后的行。
 *
 * `created_at` 是 TIMESTAMP WITHOUT TIME ZONE，参数必须显式 `::timestamp`
 * 与列同型，避免会话时区参与隐式转换。该表会持续追加（档 B 年增千万级），
 * 条件必须能沿用 `(store_id, created_at desc, id desc)` 索引的排序。
 */
export const buildInventoryAdjustmentCursorSql = (
  cursor: InventoryAdjustmentCursor,
): Prisma.Sql =>
  Prisma.sql`(
    created_at < ${cursor.createdAt}::timestamp
    OR (
      created_at = ${cursor.createdAt}::timestamp
      AND id < ${cursor.id}
    )
  )`;

/** 分页参数归一：cursor 优先，缺省回退 page/pageSize（兼容期双路径并存） */
export const resolveInventoryAdjustmentPaging = (
  query: InventoryAdjustmentsListQueryInput,
  options: { defaultPageSize: number; maxPageSize: number },
): InventoryAdjustmentPaging => {
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
    cursor: decodeInventoryAdjustmentCursor(query.cursor),
  };
};
