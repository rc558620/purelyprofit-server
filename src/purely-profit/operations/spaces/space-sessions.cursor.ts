// 空间会话列表游标分页：排序链 (startTime, id) 的编解码与条件构造（纯函数，不持有 IO 依赖）
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
} from '../../../shared/cursor-pagination.utils';
import { resolveSpaceSessionPageQuery } from './space-sessions.query';

/**
 * 列表排序：`startTime` 是开台时间，整点批量开台、同一秒并发开台都会让它重复，
 * 必须以 `id` 兜底，否则同值行在游标翻页时会漏读或重复读。
 *
 * 该顺序与表索引 `(storeId, status, startTime desc, id desc)` 逐列同向匹配。
 */
export const SPACE_SESSION_LIST_ORDER_BY = [
  { startTime: 'desc' },
  { id: 'desc' },
] satisfies Prisma.SpaceSessionOrderByWithRelationInput[];

/** 空间会话列表游标内容：与 SPACE_SESSION_LIST_ORDER_BY 的排序键一一对应 */
export interface SpaceSessionListCursor {
  startTime: Date;
  id: number;
}

/** 空间会话列表分页参数归一结果 */
export interface SpaceSessionListPaging {
  /** 页码：仅用于 meta 回填，游标路径下不再参与取数 */
  page: number;
  /** 实际生效的每页条数（已按上限钳制） */
  limit: number;
  /** 兼容期 offset：仅在未传 cursor 时生效 */
  offset: number;
  /** 游标：null 表示第一页或走 offset 兼容路径 */
  cursor: SpaceSessionListCursor | null;
}

/** 编码列表游标（前端原样回传 nextCursor 即可） */
export const encodeSpaceSessionListCursor = (row: {
  startTime: Date;
  id: number;
}): string => encodeCursor({ keys: [row.startTime.getTime()], id: row.id });

/** 解码列表游标：空值视为第一页，格式非法由公共解码器抛 400 */
export const decodeSpaceSessionListCursor = (
  raw?: string | null,
): SpaceSessionListCursor | null => {
  const payload = decodeCursor(raw);
  if (!payload) {
    return null;
  }
  const [startTimeMs] = payload.keys;
  if (
    typeof startTimeMs !== 'number' ||
    !Number.isSafeInteger(startTimeMs) ||
    startTimeMs <= 0
  ) {
    throw new BadRequestException(CURSOR_INVALID_MESSAGE);
  }
  return { startTime: new Date(startTimeMs), id: payload.id };
};

/**
 * 游标条件：只保留严格排在游标之后的行。
 *
 * 两个分支对应两级排序键：`startTime` 相同必须再比 `id`，
 * 否则同一时刻开台的多笔会话会漏读。
 */
export const buildSpaceSessionListCursorWhere = (
  cursor: SpaceSessionListCursor,
): Prisma.SpaceSessionWhereInput => ({
  OR: [
    { startTime: { lt: cursor.startTime } },
    { startTime: cursor.startTime, id: { lt: cursor.id } },
  ],
});

/** 分页参数归一：cursor 优先，缺省回退 page/pageSize（兼容期双路径并存） */
export const resolveSpaceSessionListPaging = (
  configService: ConfigService,
  query: { page?: number; pageSize?: number; cursor?: string },
): SpaceSessionListPaging => {
  // 复用既有归一逻辑：offset 路径的 page/skip/take 语义必须与迁移前逐字一致
  const { page, skip, take } = resolveSpaceSessionPageQuery(
    configService,
    query.page,
    query.pageSize,
  );
  return {
    page,
    limit: take,
    offset: skip,
    cursor: decodeSpaceSessionListCursor(query.cursor),
  };
};
