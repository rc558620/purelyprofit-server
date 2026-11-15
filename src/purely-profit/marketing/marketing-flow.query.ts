// 营销流水列表分页读取（储值 / 退款 / 积分）
//
// 门店维度列表（`/marketing/recharges`、`/marketing/points-records`）已接入游标分页：
// 传 cursor 时走 keyset（行值比较下推为索引条件），不传时保持迁移前的 offset 语义。
// 顾客维度列表仍只有 offset 语义，本次不在迁移范围内。
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildMarketingFlowCursorSql,
  type MarketingFlowCursor,
} from './marketing-flow.cursor';
import { RECHARGE_COLUMNS, RECHARGE_FROM } from './marketing.query';
import type {
  MarketingPointsRecordListQueryInput,
  MarketingPointsRecordRow,
  MarketingRechargeListQueryInput,
  MarketingRechargeRow,
} from './marketing.types';

/** 流水列表分页取数参数：skip/take 来自分页归一，cursor 优先于 skip */
interface MarketingFlowPageInput {
  skip: number;
  take: number;
  cursor?: MarketingFlowCursor | null;
}

const POINTS_RECORD_COLUMNS = Prisma.sql`
  pr.id,
  pr.store_id AS "storeId",
  pr.customer_id AS "customerId",
  pr.amount,
  pr.type::text AS "type",
  pr.description,
  pr.created_at AS "createdAt"
`;

const POINTS_RECORD_FROM = Prisma.sql`
  FROM marketing_points_records pr
`;

interface RechargeRowWithTotal extends MarketingRechargeRow {
  _total: number;
}

interface PointsRecordRowWithTotal extends MarketingPointsRecordRow {
  _total: number;
}

/**
 * 分页 + 总数一次查询（offset 路径）：`COUNT(*) OVER()` 在 LIMIT 之前对全量匹配行计数，
 * 与单独发一条 count 语义等价，但省掉一次往返和一次连接占用。
 *
 * 传 cursor 时 `COUNT(*) OVER()` 会被游标条件一起过滤，无法再当全量 total 使用，
 * 因此游标路径改为「同源筛选的独立 count + 游标页」两条查询，两条路径下 `total`
 * 都是「与筛选同源、不含游标」的全量口径。
 */
export async function queryRechargePage(
  prisma: PrismaService,
  input: MarketingRechargeListQueryInput & MarketingFlowPageInput,
): Promise<{ items: MarketingRechargeRow[]; total: number }> {
  const filters = Prisma.sql`
    WHERE r.store_id = ${input.storeId}
      ${input.customerId ? Prisma.sql`AND r.customer_id = ${input.customerId}` : Prisma.empty}
      ${input.startMs ? Prisma.sql`AND r.created_at >= ${new Date(input.startMs)}` : Prisma.empty}
      ${input.endMs ? Prisma.sql`AND r.created_at <= ${new Date(input.endMs)}` : Prisma.empty}
  `;

  if (!input.cursor) {
    const rows = await prisma.$queryRaw<RechargeRowWithTotal[]>`
      SELECT ${RECHARGE_COLUMNS}, COUNT(*) OVER()::int AS _total
      ${RECHARGE_FROM}
      ${filters}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${input.take} OFFSET ${input.skip}
    `;

    return { items: rows, total: rows[0]?._total ?? 0 };
  }

  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<MarketingRechargeRow[]>`
      SELECT ${RECHARGE_COLUMNS}
      ${RECHARGE_FROM}
      ${filters}
      ${buildMarketingFlowCursorSql(input.cursor, {
        createdAt: Prisma.sql`r.created_at`,
        id: Prisma.sql`r.id`,
      })}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${input.take}
    `,
    prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      ${RECHARGE_FROM}
      ${filters}
    `,
  ]);

  return { items: rows, total: totalRows[0]?.total ?? 0 };
}

export async function queryCustomerRechargePage(
  prisma: PrismaService,
  customerId: number,
  skip: number,
  take: number,
): Promise<{ items: MarketingRechargeRow[]; total: number }> {
  const rows = await prisma.$queryRaw<RechargeRowWithTotal[]>`
    SELECT ${RECHARGE_COLUMNS}, COUNT(*) OVER()::int AS _total
    ${RECHARGE_FROM}
    WHERE r.customer_id = ${customerId}
      AND r.type IN ('recharge', 'gift')
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${take} OFFSET ${skip}
  `;

  return { items: rows, total: rows[0]?._total ?? 0 };
}

export async function queryCustomerRefundPage(
  prisma: PrismaService,
  customerId: number,
  skip: number,
  take: number,
): Promise<{ items: MarketingRechargeRow[]; total: number }> {
  const rows = await prisma.$queryRaw<RechargeRowWithTotal[]>`
    SELECT ${RECHARGE_COLUMNS}, COUNT(*) OVER()::int AS _total
    ${RECHARGE_FROM}
    WHERE r.customer_id = ${customerId}
      AND r.type = 'refund'
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${take} OFFSET ${skip}
  `;

  return { items: rows, total: rows[0]?._total ?? 0 };
}

/** 积分流水分页：与 queryRechargePage 同构（同样的双路径与 total 口径） */
export async function queryPointsRecordPage(
  prisma: PrismaService,
  input: MarketingPointsRecordListQueryInput & MarketingFlowPageInput,
): Promise<{ items: MarketingPointsRecordRow[]; total: number }> {
  const filters = Prisma.sql`
    WHERE pr.store_id = ${input.storeId}
      ${input.customerId ? Prisma.sql`AND pr.customer_id = ${input.customerId}` : Prisma.empty}
      ${input.type ? Prisma.sql`AND pr.type = ${input.type}::"MarketingPointsChangeType"` : Prisma.empty}
      ${input.startMs ? Prisma.sql`AND pr.created_at >= ${new Date(input.startMs)}` : Prisma.empty}
      ${input.endMs ? Prisma.sql`AND pr.created_at <= ${new Date(input.endMs)}` : Prisma.empty}
  `;

  if (!input.cursor) {
    const rows = await prisma.$queryRaw<PointsRecordRowWithTotal[]>`
      SELECT ${POINTS_RECORD_COLUMNS}, COUNT(*) OVER()::int AS _total
      ${POINTS_RECORD_FROM}
      ${filters}
      ORDER BY pr.created_at DESC, pr.id DESC
      LIMIT ${input.take} OFFSET ${input.skip}
    `;

    return { items: rows, total: rows[0]?._total ?? 0 };
  }

  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<MarketingPointsRecordRow[]>`
      SELECT ${POINTS_RECORD_COLUMNS}
      ${POINTS_RECORD_FROM}
      ${filters}
      ${buildMarketingFlowCursorSql(input.cursor, {
        createdAt: Prisma.sql`pr.created_at`,
        id: Prisma.sql`pr.id`,
      })}
      ORDER BY pr.created_at DESC, pr.id DESC
      LIMIT ${input.take}
    `,
    prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      ${POINTS_RECORD_FROM}
      ${filters}
    `,
  ]);

  return { items: rows, total: totalRows[0]?.total ?? 0 };
}

export async function queryCustomerPointsRecordPage(
  prisma: PrismaService,
  customerId: number,
  input: Omit<MarketingPointsRecordListQueryInput, 'storeId' | 'customerId'> & {
    skip: number;
    take: number;
  },
): Promise<{ items: MarketingPointsRecordRow[]; total: number }> {
  const rows = await prisma.$queryRaw<PointsRecordRowWithTotal[]>`
    SELECT ${POINTS_RECORD_COLUMNS}, COUNT(*) OVER()::int AS _total
    ${POINTS_RECORD_FROM}
    WHERE pr.customer_id = ${customerId}
      ${input.type ? Prisma.sql`AND pr.type = ${input.type}::"MarketingPointsChangeType"` : Prisma.empty}
      ${input.startMs ? Prisma.sql`AND pr.created_at >= ${new Date(input.startMs)}` : Prisma.empty}
      ${input.endMs ? Prisma.sql`AND pr.created_at <= ${new Date(input.endMs)}` : Prisma.empty}
    ORDER BY pr.created_at DESC, pr.id DESC
    LIMIT ${input.take} OFFSET ${input.skip}
  `;

  return { items: rows, total: rows[0]?._total ?? 0 };
}
