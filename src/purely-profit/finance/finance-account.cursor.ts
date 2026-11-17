// 账款列表游标分页：排序链 (dueDate ASC, updatedAt DESC, id DESC) 的编解码与条件构造
// （纯函数，不持有 IO 依赖）
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CURSOR_INVALID_MESSAGE,
  decodeCursor,
  encodeCursor,
} from '../../shared/cursor-pagination.utils';
import { buildPaginationState } from './finance-pagination.utils';
import type { FinanceAccountsListQueryInput } from './finance.types';

/**
 * 列表排序链，与表索引
 * `(store_id, due_date, updated_at DESC, id DESC)` 逐列同向匹配。
 *
 * 为什么不按 status 排：status 是写入时的派生快照，且枚举声明顺序
 * （pending < partial < settled < overdue）会把逾期排到最后，与业务优先级相反。
 * 为什么必须带 id：dueDate 与 updatedAt 都可能重复（同批补录），
 * 缺第三级兜底会在同值行上漏读或重复读。
 */
export const FINANCE_ACCOUNT_ORDER_BY = [
  { dueDate: 'asc' },
  { updatedAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.FinanceAccountRecordOrderByWithRelationInput[];

/**
 * `due_date` 为 NULL 的游标哨兵值。
 *
 * PostgreSQL 对 ASC 默认 NULLS LAST（与前端「无到期日排最后」的既有展示一致），
 * 而共享游标载荷只接受 string | number，无法直接承载 null。
 * 到期日是毫秒时间戳，恒为非负数，因此用 -1 作哨兵无歧义；
 * 解码时任何小于 -1 的第一级键都判为非法游标。
 */
const NULL_DUE_DATE_CURSOR_KEY = -1;

/** 账款列表游标内容：与 FINANCE_ACCOUNT_ORDER_BY 的排序键一一对应 */
export interface FinanceAccountListCursor {
  /** null 表示该行没有到期日（排序上位于最后一段） */
  dueDate: Date | null;
  updatedAt: Date;
  id: number;
}

/** 账款列表分页参数归一结果 */
export interface FinanceAccountListPaging {
  /** 页码：仅用于 meta 回填，游标路径下不再参与取数 */
  page: number;
  /** 实际生效的每页条数 */
  limit: number;
  /** 兼容期 offset：仅在未传 cursor 时生效 */
  offset: number;
  /** 游标：null 表示第一页或走 offset 兼容路径 */
  cursor: FinanceAccountListCursor | null;
}

/** 编码列表游标（前端原样回传 nextCursor 即可） */
export const encodeFinanceAccountCursor = (row: {
  dueDate: Date | null;
  updatedAt: Date;
  id: number;
}): string =>
  encodeCursor({
    keys: [
      row.dueDate ? row.dueDate.getTime() : NULL_DUE_DATE_CURSOR_KEY,
      row.updatedAt.getTime(),
    ],
    id: row.id,
  });

/** 解码列表游标：空值视为第一页，格式非法由公共解码器抛 400 */
export const decodeFinanceAccountCursor = (
  raw?: string | null,
): FinanceAccountListCursor | null => {
  const payload = decodeCursor(raw);
  if (!payload) {
    return null;
  }
  if (payload.keys.length !== 2) {
    throw new BadRequestException(CURSOR_INVALID_MESSAGE);
  }

  const [dueDateKey, updatedAtKey] = payload.keys;
  if (
    typeof dueDateKey !== 'number' ||
    !Number.isSafeInteger(dueDateKey) ||
    dueDateKey < NULL_DUE_DATE_CURSOR_KEY ||
    typeof updatedAtKey !== 'number' ||
    !Number.isSafeInteger(updatedAtKey) ||
    updatedAtKey < 0
  ) {
    throw new BadRequestException(CURSOR_INVALID_MESSAGE);
  }

  return {
    dueDate:
      dueDateKey === NULL_DUE_DATE_CURSOR_KEY ? null : new Date(dueDateKey),
    updatedAt: new Date(updatedAtKey),
    id: payload.id,
  };
};

/**
 * 「有到期日」段的游标条件：只保留严格排在游标之后、且 due_date 非空的行。
 *
 * 关键在于外层那个 `dueDate: { gte }`：它把 OR 里的第一级排序键下推成索引
 * 起始位置（Index Cond），翻译成 SQL 就是
 *   `due_date >= $d AND (due_date > $d OR (due_date = $d AND updated_at < $u) OR ...)`。
 *
 * 如果省掉它、只留三段 OR，PostgreSQL 无法把条件下推成扫描起点，只能从索引
 * 头部开始逐条过滤，深页退化成 O(offset)。诊断库实测（单店 12 万行）：
 *   只有 OR（含 NULL 段）：深页 5000 → 2.4 ms；30000 → 13.7 ms；60000 → 27.7 ms
 *   下推 gte 后：        深页 5000 → 0.057 ms；30000 → 0.071 ms；60000 → 0.053 ms
 * 代价是 `due_date IS NULL` 的尾段不能塞进同一个 OR（NULL 永远不满足 >=），
 * 必须拆成第二段查询——这正是 {@link buildFinanceAccountNullSegmentWhere} 的职责。
 */
export const buildFinanceAccountCursorWhere = (cursor: {
  dueDate: Date;
  updatedAt: Date;
  id: number;
}): Prisma.FinanceAccountRecordWhereInput => ({
  dueDate: { gte: cursor.dueDate },
  OR: [
    { dueDate: { gt: cursor.dueDate } },
    { dueDate: cursor.dueDate, updatedAt: { lt: cursor.updatedAt } },
    {
      dueDate: cursor.dueDate,
      updatedAt: cursor.updatedAt,
      id: { lt: cursor.id },
    },
  ],
});

/**
 * 「无到期日」段的游标条件（NULLS LAST 的尾段，排在所有有到期日的行之后）。
 *
 * - 游标行无到期日：已在尾段内，按 (updatedAt DESC, id DESC) 继续严格推进，
 *   不能退回前段，否则重复读；
 * - 游标行有到期日：尾段尚未开始，取全部 `due_date IS NULL` 的行。
 */
export const buildFinanceAccountNullSegmentWhere = (
  cursor: FinanceAccountListCursor,
): Prisma.FinanceAccountRecordWhereInput => {
  if (cursor.dueDate === null) {
    return {
      dueDate: null,
      OR: [
        { updatedAt: { lt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
      ],
    };
  }

  return { dueDate: null };
};

/**
 * 分页参数归一：cursor 优先，缺省回退 page/pageSize（兼容期双路径并存）。
 *
 * 复用财务域既有的 `buildPaginationState`：入口 DTO 已 `@Max(100)` 钳制 pageSize，
 * 这里保持同一口径，避免迁移顺带改变 offset 路径的 skip/take 与列表缓存 key
 * （key 里含 page/pageSize）。
 */
export const resolveFinanceAccountPaging = (
  query: FinanceAccountsListQueryInput & { cursor?: string },
): FinanceAccountListPaging => {
  const { page, pageSize } = buildPaginationState(query.page, query.pageSize);
  return {
    page,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    cursor: decodeFinanceAccountCursor(query.cursor),
  };
};
