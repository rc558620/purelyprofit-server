import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  FinanceCashFlowDirectionValue,
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

export async function queryCashFlowRecordPage(
  prisma: PrismaService,
  params: {
    where: Prisma.FinanceCashFlowRecordWhereInput;
    page: number;
    pageSize: number;
  },
): Promise<{ total: number; records: FinanceCashFlowRecordWithAmount[] }> {
  const [total, records] = await Promise.all([
    prisma.financeCashFlowRecord.count({ where: params.where }),
    prisma.financeCashFlowRecord.findMany({
      where: params.where,
      select: CASH_FLOW_RECORD_PAGE_SELECT,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
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

export async function findCashFlowRecordOwnership(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<{ id: number; saleOrderId: number | null } | null> {
  return prisma.financeCashFlowRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    select: {
      id: true,
      saleOrderId: true,
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
