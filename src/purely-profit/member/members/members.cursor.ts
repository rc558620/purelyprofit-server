// 会员列表游标分页：排序链 (created_at, id) 的编解码与原生 SQL 条件片段（纯函数）
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
} from '../../../shared/cursor-pagination.utils';
import { resolvePagination } from './members.utils';

/**
 * 排序键语义版本。
 *
 * 列表排序键曾经是 `updated_at`（`Member.updatedAt` 会被 Prisma `@updatedAt`
 * 自动刷新），后改为不可变的 `created_at`。两者都是“毫秒时间戳 + id”两段式、
 * 载荷形状完全一致，单看键值无法区分语义——旧游标会被当成 `created_at` 静默使用，
 * 直接导致跳页。
 *
 * 因此把版本号固定写进载荷第二位：解码时版本不符即判定为“不属于当前排序语义”
 * 的非法游标（按契约统一 400），而不是静默降级。版本号不参与任何 SQL 比较，
 * 只承担兼容性识别。
 */
const MEMBER_LIST_CURSOR_KEY_VERSION = 2;

/** 会员列表游标内容：与 `ORDER BY m.created_at DESC, m.id DESC` 一一对应 */
export interface MemberListCursor {
  createdAt: Date;
  id: number;
}

/** 会员列表分页参数归一结果 */
export interface MemberListPaging {
  /** 页码：仅用于 meta 回填，游标路径下不再参与取数 */
  page: number;
  /** 实际生效的每页条数（已按上限钳制） */
  limit: number;
  /** 兼容期 offset：仅在未传 cursor 时生效 */
  offset: number;
  /** 游标：null 表示第一页或走 offset 兼容路径 */
  cursor: MemberListCursor | null;
}

/** 编码列表游标（前端原样回传 nextCursor 即可） */
export const encodeMemberListCursor = (row: {
  createdAt: Date;
  id: number;
}): string =>
  encodeCursor({
    keys: [row.createdAt.getTime(), MEMBER_LIST_CURSOR_KEY_VERSION],
    id: row.id,
  });

/**
 * 解码列表游标：空值视为第一页，格式非法或排序键语义不符一律由 400 拒绝。
 *
 * 排序键换成 `created_at` 之前发出的游标只有 1 个键，与当前 2 键载荷长度不符，
 * 会在这里被判定为非法：宁可让滚动中的会话报一次 400 并重新拉首屏，
 * 也不能让它带着错误语义静默跳过一整段会员。
 */
export const decodeMemberListCursor = (
  raw?: string | null,
): MemberListCursor | null => {
  const payload = decodeCursor(raw);
  if (!payload) {
    return null;
  }
  const [createdAtMs, keyVersion] = payload.keys;
  if (
    payload.keys.length !== 2 ||
    keyVersion !== MEMBER_LIST_CURSOR_KEY_VERSION ||
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
 * 用行比较 `(created_at, id) < (?, ?)` 而不是等价的 `created_at < ? OR (created_at = ? AND id < ?)`：
 * 后者无法进入索引条件，规划器只能从索引最新端逐行 Filter，深页成本随已翻页数线性增长。
 * 行比较可以直接作为 `(store_id, created_at DESC, id DESC)` 的 Index Cond，
 * 每页只读 limit+1 条索引项（EXPLAIN 实测：深页 3216 buffers → 18 buffers）。
 *
 * `created_at` 是 TIMESTAMP WITHOUT TIME ZONE，参数必须显式 `::timestamp`
 * 与列同型，避免会话时区参与隐式转换（与 members-write.query.ts 的写入口径一致）。
 */
export const buildMemberListCursorSql = (
  cursor: MemberListCursor,
): Prisma.Sql =>
  Prisma.sql`(
    m.created_at, m.id
  ) < (${cursor.createdAt}::timestamp, ${cursor.id})`;

/** 分页参数归一：cursor 优先，缺省回退 page/pageSize（兼容期双路径并存） */
export const resolveMemberListPaging = (
  query: { page?: number; pageSize?: number; cursor?: string },
  options: { defaultPageSize: number; maxPageSize: number },
): MemberListPaging => {
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
    cursor: decodeMemberListCursor(query.cursor),
  };
};
