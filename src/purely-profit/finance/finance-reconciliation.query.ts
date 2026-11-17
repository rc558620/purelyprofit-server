import { FinanceReconciliationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getShanghaiMonthStartMs } from '../../shared/shanghai-time.utils';
import type {
  FinanceReconciliationRecordWithItems,
  FinanceReconciliationsListQueryInput,
} from './finance.types';

const FINANCE_RECONCILIATION_RECORD_INCLUDE = {
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.FinanceReconciliationRecordInclude;

function buildFinanceReconciliationWhere(
  storeId: number,
  query: FinanceReconciliationsListQueryInput,
): Prisma.FinanceReconciliationRecordWhereInput {
  const where: Prisma.FinanceReconciliationRecordWhereInput = {
    storeId,
  };

  if (query.statusFilter && query.statusFilter !== 'all') {
    where.status = query.statusFilter;
  }

  if (query.typeFilter && query.typeFilter !== 'all') {
    where.type = query.typeFilter;
  }

  const trimmedSearchText = query.searchText?.trim();
  if (trimmedSearchText) {
    where.OR = [
      {
        title: {
          contains: trimmedSearchText,
          mode: 'insensitive',
        },
      },
      {
        counterpart: {
          contains: trimmedSearchText,
          mode: 'insensitive',
        },
      },
      {
        note: {
          contains: trimmedSearchText,
          mode: 'insensitive',
        },
      },
    ];
  }

  return where;
}

/**
 * 对账统计的聚合行（按状态分组，金额单位为数据库分）。
 */
export interface FinanceReconciliationStatsRow {
  status: FinanceReconciliationStatus;
  count: number;
  /** 该状态下的差异绝对值和；draft 为占位差异，SQL 阶段已排除 */
  diffTotal: number;
  newThisMonth: number;
}

interface RawReconciliationStatsRow {
  status: string;
  count: number;
  diff_total: bigint | number | string | null;
  new_this_month: number;
}

/**
 * 对账统计走单条 SQL 聚合，不再把全部对账单连同明细项（items）拉回内存计数。
 *
 * 原实现 `findMany({ include: { items } })` 的传输量是「对账单数 + 明细项总数」，
 * 只为了算出 4 个状态计数和差异合计，明细项在这里完全无用。
 * 现改为一次 GROUP BY status 聚合：返回行数 ≤ 状态数（4），
 * 差异合计用 SUM(ABS(diff_amount)) FILTER 在 DB 侧取绝对值并排除 draft 占位值。
 */
export async function queryReconciliationStatsRows(
  prisma: PrismaService,
  params: { storeId: number; now: number },
): Promise<FinanceReconciliationStatsRow[]> {
  const monthStart = new Date(getShanghaiMonthStartMs(params.now));
  const rows = await prisma.$queryRaw<RawReconciliationStatsRow[]>`
    SELECT
      status::text AS "status",
      COUNT(*)::int AS "count",
      COALESCE(SUM(ABS(diff_amount)) FILTER (WHERE status <> 'draft'), 0) AS "diff_total",
      COUNT(*) FILTER (WHERE created_at >= ${monthStart})::int AS "new_this_month"
    FROM finance_reconciliation_records
    WHERE store_id = ${params.storeId}
    GROUP BY status
  `;

  return rows.map((row) => ({
    status: row.status as FinanceReconciliationStatus,
    count: Number(row.count),
    diffTotal: Number(row.diff_total ?? 0),
    newThisMonth: Number(row.new_this_month),
  }));
}

export async function queryReconciliationRecordPage(
  prisma: PrismaService,
  storeId: number,
  query: FinanceReconciliationsListQueryInput,
): Promise<{ items: FinanceReconciliationRecordWithItems[]; total: number }> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const where = buildFinanceReconciliationWhere(storeId, query);

  const [items, total] = await Promise.all([
    prisma.financeReconciliationRecord.findMany({
      where,
      include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.financeReconciliationRecord.count({ where }),
  ]);

  return {
    items,
    total,
  };
}

export async function createReconciliationRecordEntity(
  prisma: PrismaService,
  data: Prisma.FinanceReconciliationRecordCreateArgs['data'],
): Promise<FinanceReconciliationRecordWithItems> {
  return prisma.financeReconciliationRecord.create({
    data,
    include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
  });
}

export async function findReconciliationRecord(
  prisma: PrismaService | Prisma.TransactionClient,
  params: { storeId: number; recordId: number },
): Promise<FinanceReconciliationRecordWithItems | null> {
  return prisma.financeReconciliationRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
  });
}

/**
 * 确认/调整对账单：带「前置状态」条件更新，用影响行数判定是否被并发抢占。
 *
 * 原实现 `update({ where: { id } })` 只按主键写，两个人同时确认同一张差异单
 * 会各自把状态改成 confirmed / adjusted，后写覆盖先写且无人报错。
 * 这里要求当前状态必须仍是 `fromStatus`，命中 0 行即说明已被他人处理。
 *
 * @returns null 表示前置状态不匹配（已被并发修改或删除）
 */
export async function updateReconciliationConfirmation(
  prisma: PrismaService | Prisma.TransactionClient,
  params: {
    storeId: number;
    recordId: number;
    fromStatus: FinanceReconciliationStatus;
    status: FinanceReconciliationStatus;
    adjustNote: string | null;
  },
): Promise<FinanceReconciliationRecordWithItems | null> {
  const result = await prisma.financeReconciliationRecord.updateMany({
    where: {
      id: params.recordId,
      storeId: params.storeId,
      status: params.fromStatus,
    },
    data: {
      status: params.status,
      adjustNote: params.adjustNote,
    },
  });

  if (result.count === 0) {
    return null;
  }

  return findReconciliationRecord(prisma, {
    storeId: params.storeId,
    recordId: params.recordId,
  });
}

/**
 * 删除「未确认」对账单：把可删状态下推成删除条件，避免 read-then-write 竞态，
 * 同时补上 storeId 约束（原先只按 id 删除，越权校验完全依赖调用方先查一次）。
 *
 * @returns true 表示删除成功；false 表示记录不存在或状态已不允许删除
 */
export async function deleteUnconfirmedReconciliationRecordEntity(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<boolean> {
  const result = await prisma.financeReconciliationRecord.deleteMany({
    where: {
      id: params.recordId,
      storeId: params.storeId,
      status: {
        in: [
          FinanceReconciliationStatus.draft,
          FinanceReconciliationStatus.discrepancy,
        ],
      },
    },
  });

  return result.count > 0;
}
