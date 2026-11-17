// 账款列表读路径：offset / keyset 双路径分页查询（写路径与条件构造见 finance-account.query.ts）
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { withDerivedAccountFields } from './finance-account.domain';
import {
  buildFinanceAccountCursorWhere,
  buildFinanceAccountNullSegmentWhere,
  FINANCE_ACCOUNT_ORDER_BY,
} from './finance-account.cursor';
import type {
  FinanceAccountListCursor,
  FinanceAccountListPaging,
} from './finance-account.cursor';
import {
  buildFinanceAccountWhere,
  financeAccountRecordSelect,
} from './finance-account.query';
import type {
  FinanceAccountRecordWithAmount,
  FinanceAccountsListQueryInput,
} from './finance.types';

/**
 * 游标路径取页：先取「有到期日」段，未取满再补「无到期日」尾段。
 *
 * 拆两段的原因见 `buildFinanceAccountCursorWhere` 的注释：把 `due_date >= ?`
 * 下推成索引起点后，NULL 行无法再从一个 OR 分支里取到（NULL 永不满足 >=），
 * 因此尾段必须单独查。两段顺序天然满足全局排序（NULLS LAST）：
 * - 第一段返回 `limit + 1` 行 → 页已满，尾段不会被读到；
 * - 第一段不足 → 用剩余额度补尾段，最后一行可能就是 `limit + 1` 的探测行。
 */
async function queryAccountPageByCursor(
  prisma: PrismaService,
  where: Prisma.FinanceAccountRecordWhereInput,
  cursor: FinanceAccountListCursor,
  limit: number,
): Promise<FinanceAccountRecordWithAmount[]> {
  const required = limit + 1;
  const { dueDate, updatedAt, id } = cursor;

  const headRows =
    dueDate === null
      ? []
      : await prisma.financeAccountRecord.findMany({
          where: {
            AND: [
              where,
              buildFinanceAccountCursorWhere({ dueDate, updatedAt, id }),
            ],
          },
          orderBy: FINANCE_ACCOUNT_ORDER_BY,
          select: financeAccountRecordSelect,
          take: required,
        });

  if (headRows.length >= required) {
    return headRows;
  }

  const tailRows = await prisma.financeAccountRecord.findMany({
    where: {
      AND: [where, buildFinanceAccountNullSegmentWhere(cursor)],
    },
    orderBy: FINANCE_ACCOUNT_ORDER_BY,
    select: financeAccountRecordSelect,
    take: required - headRows.length,
  });

  return [...headRows, ...tailRows];
}

/**
 * 账款分页查询（双路径）。
 *
 * - `cursor` 为空：走 offset 路径，skip/take 与迁移前逐字一致（缓存行为不变）。
 * - `cursor` 非空：走 keyset，`take = limit + 1`，多取的一行只用于探测下一页。
 *
 * total 恒为「与筛选同源、不含游标」的全量口径：COUNT 只带筛选条件，
 * 否则翻页过程中总数会一路变小（与现金流水的 `queryCashFlowRecordPage` 同一约定）。
 */
export async function queryAccountRecords(
  prisma: PrismaService,
  storeId: number,
  query: FinanceAccountsListQueryInput,
  paging: FinanceAccountListPaging,
): Promise<{ items: FinanceAccountRecordWithAmount[]; total: number }> {
  const where = buildFinanceAccountWhere(storeId, query, Date.now());

  const [total, records] = await Promise.all([
    prisma.financeAccountRecord.count({ where }),
    paging.cursor
      ? queryAccountPageByCursor(prisma, where, paging.cursor, paging.limit)
      : prisma.financeAccountRecord.findMany({
          where,
          // 按到期日升序：最早到期（即已逾期）的排最前，无到期日的排在最后
          // （PostgreSQL ASC 默认 NULLS LAST）。
          // 不按 status 排：status 是写入时的派生快照，且 enum 声明顺序
          // （pending<partial<settled<overdue）会把逾期排到最后，与业务优先级相反。
          orderBy: FINANCE_ACCOUNT_ORDER_BY,
          select: financeAccountRecordSelect,
          skip: paging.offset,
          take: paging.limit,
        }),
  ]);

  // 展示层仍通过 withDerivedAccountFields 兜底，确保 remaining 和 status 与事实一致
  const derivedRecords = records.map((record) =>
    withDerivedAccountFields(record),
  );

  return {
    items: derivedRecords,
    total,
  };
}
