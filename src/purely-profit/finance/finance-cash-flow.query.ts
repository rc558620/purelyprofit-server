import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildFinanceCashFlowCursorWhere,
  FINANCE_CASH_FLOW_ORDER_BY,
} from './finance-cash-flow.cursor';
import type { FinanceCashFlowListCursor } from './finance-cash-flow.cursor';
import type {
  FinanceCashFlowFilterRange,
  FinanceCashFlowRecordWithAmount,
} from './finance.types';

/**
 * SQL groupBy 聚合结果：按 direction 分组的金额合计与行数。
 * 替代原来全量 findMany 后内存遍历的方式，DB 侧完成聚合。
 */
export interface FinanceCashFlowStatsAggregate {
  direction: string;
  totalAmount: number; // 数据库分
  rowCount: number;
}

const CASH_FLOW_RECORD_PAGE_SELECT = {
  id: true,
  direction: true,
  category: true,
  title: true,
  amount: true,
  payment: true,
  note: true,
  date: true,
  createdAt: true,
} satisfies Prisma.FinanceCashFlowRecordSelect;

/**
 * 现金流水分页查询（双路径）。
 *
 * - `cursor` 为空：走 offset 路径，skip/take 与迁移前逐字一致（缓存行为不变）。
 * - `cursor` 非空：where 里额外叠加 keyset 条件，不再传 skip；
 *   `take` 由调用方按 `limit + 1` 传入，多取的一行用于探测「是否还有下一页」。
 *
 * total 恒为「与筛选同源、不含游标」的全量口径：COUNT 只带筛选条件，
 * 否则翻页过程中总数会一路变小。
 */
export async function queryCashFlowRecordPage(
  prisma: PrismaService,
  params: {
    where: Prisma.FinanceCashFlowRecordWhereInput;
    skip: number;
    take: number;
    /** 游标：非空时走游标路径（此时 skip 被忽略） */
    cursor?: FinanceCashFlowListCursor | null;
  },
): Promise<{ total: number; records: FinanceCashFlowRecordWithAmount[] }> {
  const listWhere = params.cursor
    ? { AND: [params.where, buildFinanceCashFlowCursorWhere(params.cursor)] }
    : params.where;
  const [total, records] = await Promise.all([
    prisma.financeCashFlowRecord.count({ where: params.where }),
    prisma.financeCashFlowRecord.findMany({
      where: listWhere,
      select: CASH_FLOW_RECORD_PAGE_SELECT,
      orderBy: FINANCE_CASH_FLOW_ORDER_BY,
      ...(params.cursor ? {} : { skip: params.skip }),
      take: params.take,
    }),
  ]);

  return { total, records };
}

/**
 * 查询区间内流水用于统计。
 * 刻意不提供 directionFilter：统计口径恒为全量收支，不跟随列表的方向筛选
 * （统计卡需同时展示收入与支出，跟随筛选会让另一侧恒为 0）。
 *
 * 改写：原全量 findMany 拉取所有流水行到内存遍历累加，
 * 档B year 周期单店 ~1.5 万行有退化风险。
 * 改为 SQL groupBy 聚合，只返回 2 行（income/expense），
 * DB→App 传输量从 N 行降到 ≤2 行。
 */
export async function queryCashFlowStatsRows(
  prisma: PrismaService,
  params: {
    storeId: number;
    range: FinanceCashFlowFilterRange | { start: number; end: number };
  },
): Promise<FinanceCashFlowStatsAggregate[]> {
  const where: Prisma.FinanceCashFlowRecordWhereInput = {
    storeId: params.storeId,
    date: {
      gte: new Date(params.range.start),
      lte: new Date(params.range.end),
    },
  };

  const rows = await prisma.financeCashFlowRecord.groupBy({
    by: ['direction'],
    where,
    _sum: { amount: true },
    _count: { _all: true },
  });

  return rows.map((row) => ({
    direction: row.direction,
    totalAmount: Number(row._sum.amount ?? 0),
    rowCount: row._count._all,
  }));
}

export async function createCashFlowRecordEntity(
  prisma: PrismaService,
  data: Prisma.FinanceCashFlowRecordCreateArgs['data'],
): Promise<FinanceCashFlowRecordWithAmount> {
  return prisma.financeCashFlowRecord.create({ data });
}

/**
 * 流水的业务归属：销售流水与销售退款流水都必须随来源单据回滚，
 * 不能通过现金流水删除接口单独抹掉。
 */
export interface FinanceCashFlowRecordOwnership {
  id: number;
  saleOrderId: number | null;
  saleOrderRefundId: number | null;
}

export async function findCashFlowRecordOwnership(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<FinanceCashFlowRecordOwnership | null> {
  return prisma.financeCashFlowRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    select: {
      id: true,
      saleOrderId: true,
      saleOrderRefundId: true,
    },
  });
}

export async function deleteCashFlowRecordEntity(
  prisma: PrismaService,
  storeId: number,
  recordId: number,
): Promise<void> {
  await prisma.financeCashFlowRecord.deleteMany({
    where: { id: recordId, storeId },
  });
}
