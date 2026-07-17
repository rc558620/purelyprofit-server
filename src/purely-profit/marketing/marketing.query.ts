import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  MarketingConsumptionRow,
  MarketingCustomerRow,
  MarketingPointsRecordListQueryInput,
  MarketingPointsRecordRow,
  MarketingPromotionRow,
  MarketingRechargeListQueryInput,
  MarketingRechargeRow,
} from './marketing.types';

/** 支持 $queryRaw 的 Prisma 客户端（兼容 PrismaService 与事务客户端）。 */
type PrismaQueryRunner = PrismaService | Prisma.TransactionClient;

/* ── 共享 SQL 片段 ─────────────────────────────────────────── */

const RECHARGE_COLUMNS = Prisma.sql`
  r.id,
  r.store_id AS "storeId",
  r.customer_id AS "customerId",
  c.name AS "customerName",
  r.amount,
  r.gift_amount AS "giftAmount",
  r.total_amount AS "totalAmount",
  r.type::text AS "type",
  r.promotion_id AS "promotionId",
  p.name AS "promotionName",
  r.note,
  r.created_at AS "createdAt"
`;

const RECHARGE_FROM = Prisma.sql`
  FROM marketing_recharges r
  JOIN marketing_customers c ON c.id = r.customer_id
  LEFT JOIN marketing_promotions p ON p.id = r.promotion_id
`;

const CONSUMPTION_COLUMNS = Prisma.sql`
  co.id,
  co.store_id AS "storeId",
  co.customer_id AS "customerId",
  c.name AS "customerName",
  co.amount,
  co.balance_paid AS "balancePaid",
  co.points_deducted AS "pointsDeducted",
  co.actual_points_deducted AS "actualPointsDeducted",
  co.pay_type::text AS "payType",
  co.items_summary AS "itemsSummary",
  co.promotion_id AS "promotionId",
  p.name AS "promotionName",
  co.created_at AS "createdAt"
`;

const CONSUMPTION_FROM = Prisma.sql`
  FROM marketing_consumptions co
  JOIN marketing_customers c ON c.id = co.customer_id
  LEFT JOIN marketing_promotions p ON p.id = co.promotion_id
`;

/**
 * 基于时间线遍历计算顾客当前赠送金额余额（分）。
 *
 * 算法规则：
 * - 充值/赠送：trackedGift += giftAmount
 * - 退款：trackedGift = max(0, trackedGift − row.giftAmount)
 *   其中 row.giftAmount 为该笔退款实际清零的赠送金额（分）。
 *   clearRemainingGift=false 的退款 giftAmount=0，不影响赠送余额；
 *   clearRemainingGift=true 的退款 giftAmount>0，扣减对应赠送。
 *
 * @param prisma  PrismaService 或事务客户端（Prisma.TransactionClient）
 * @param customerId  顾客 ID
 */
export async function queryCustomerGiftBalanceCents(
  prisma: PrismaQueryRunner,
  customerId: number,
): Promise<number> {
  const rows = await prisma.$queryRaw<
    { amount: number; giftAmount: number; totalAmount: number; type: string }[]
  >`
    SELECT amount, gift_amount AS "giftAmount",
           total_amount AS "totalAmount", type::text AS "type"
    FROM marketing_recharges
    WHERE customer_id = ${customerId}
    ORDER BY created_at ASC, id ASC
  `;

  let trackedGift = 0;

  for (const row of rows) {
    const type = row.type as string;
    if (type === 'recharge' || type === 'gift') {
      trackedGift += row.giftAmount;
    } else if (type === 'refund') {
      // BUG-1: 按退款实际清零的赠送金额扣减，而非无条件清零
      // giftAmount=0 表示 clearRemainingGift=false，不影响赠送余额
      trackedGift = Math.max(0, trackedGift - row.giftAmount);
    }
  }

  return trackedGift;
}

export async function queryCustomerRowById(
  prisma: PrismaService,
  customerId: number,
): Promise<MarketingCustomerRow | null> {
  const rows = await prisma.$queryRaw<MarketingCustomerRow[]>`
    SELECT
      c.id,
      c.store_id AS "storeId",
      c.member_id AS "memberId",
      c.name,
      c.phone,
      COALESCE(c.avatar, u.avatar, u.wechat_avatar) AS avatar,
      c.tier::text AS "tier",
      c.balance,
      c.points,
      c.total_spent AS "totalSpent",
      c.visit_count AS "visitCount",
      c.last_visit_at AS "lastVisitAt",
      c.remark,
      c.created_at AS "createdAt",
      c.updated_at AS "updatedAt"
    FROM marketing_customers c
    LEFT JOIN users u ON (
      u.wechat_phone = c.phone
      OR u.email = 'club_phone_' || c.phone || '@purelyprofit.local'
      OR u.email = 'phone_' || c.phone || '@purelyprofit.local'
    )
    WHERE c.id = ${customerId}
      AND c.deleted_at IS NULL
    ORDER BY
      CASE
        WHEN u.wechat_phone = c.phone THEN 1
        WHEN u.email = 'club_phone_' || c.phone || '@purelyprofit.local' THEN 2
        ELSE 3
      END
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function queryCustomerRecentRecharges(
  prisma: PrismaService,
  customerId: number,
  limit: number,
): Promise<MarketingRechargeRow[]> {
  return prisma.$queryRaw<MarketingRechargeRow[]>`
    SELECT ${RECHARGE_COLUMNS}
    ${RECHARGE_FROM}
    WHERE r.customer_id = ${customerId}
      AND r.type IN ('recharge', 'gift')
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `;
}

export async function queryCustomerRecentConsumptions(
  prisma: PrismaService,
  customerId: number,
  limit: number,
): Promise<MarketingConsumptionRow[]> {
  return prisma.$queryRaw<MarketingConsumptionRow[]>`
    SELECT ${CONSUMPTION_COLUMNS}
    ${CONSUMPTION_FROM}
    WHERE co.customer_id = ${customerId}
    ORDER BY co.created_at DESC
    LIMIT ${limit}
  `;
}

export async function queryRechargePage(
  prisma: PrismaService,
  input: MarketingRechargeListQueryInput & { skip: number; take: number },
): Promise<MarketingRechargeRow[]> {
  return prisma.$queryRaw<MarketingRechargeRow[]>`
    SELECT ${RECHARGE_COLUMNS}
    ${RECHARGE_FROM}
    WHERE r.store_id = ${input.storeId}
      ${input.customerId ? Prisma.sql`AND r.customer_id = ${input.customerId}` : Prisma.empty}
      ${input.startMs ? Prisma.sql`AND r.created_at >= ${new Date(input.startMs)}` : Prisma.empty}
      ${input.endMs ? Prisma.sql`AND r.created_at <= ${new Date(input.endMs)}` : Prisma.empty}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${input.take} OFFSET ${input.skip}
  `;
}

export async function queryCustomerRechargePage(
  prisma: PrismaService,
  customerId: number,
  skip: number,
  take: number,
): Promise<MarketingRechargeRow[]> {
  return prisma.$queryRaw<MarketingRechargeRow[]>`
    SELECT ${RECHARGE_COLUMNS}
    ${RECHARGE_FROM}
    WHERE r.customer_id = ${customerId}
      AND r.type IN ('recharge', 'gift')
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${take} OFFSET ${skip}
  `;
}

export async function queryCustomerRefundPage(
  prisma: PrismaService,
  customerId: number,
  skip: number,
  take: number,
): Promise<MarketingRechargeRow[]> {
  return prisma.$queryRaw<MarketingRechargeRow[]>`
    SELECT ${RECHARGE_COLUMNS}
    ${RECHARGE_FROM}
    WHERE r.customer_id = ${customerId}
      AND r.type = 'refund'
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${take} OFFSET ${skip}
  `;
}

export async function queryRechargeRowById(
  prisma: PrismaService,
  rechargeId: number,
): Promise<MarketingRechargeRow | null> {
  const rows = await prisma.$queryRaw<MarketingRechargeRow[]>`
    SELECT ${RECHARGE_COLUMNS}
    ${RECHARGE_FROM}
    WHERE r.id = ${rechargeId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

interface PointsRecordRowWithTotal extends MarketingPointsRecordRow {
  _total: number;
}

export async function queryPointsRecordPage(
  prisma: PrismaService,
  input: MarketingPointsRecordListQueryInput & { skip: number; take: number },
): Promise<{ items: MarketingPointsRecordRow[]; total: number }> {
  const rows = await prisma.$queryRaw<PointsRecordRowWithTotal[]>`
    SELECT
      pr.id,
      pr.store_id AS "storeId",
      pr.customer_id AS "customerId",
      pr.amount,
      pr.type::text AS "type",
      pr.description,
      pr.created_at AS "createdAt",
      COUNT(*) OVER()::int AS _total
    FROM marketing_points_records pr
    WHERE pr.store_id = ${input.storeId}
      ${input.customerId ? Prisma.sql`AND pr.customer_id = ${input.customerId}` : Prisma.empty}
      ${input.type ? Prisma.sql`AND pr.type = ${input.type}::"MarketingPointsChangeType"` : Prisma.empty}
      ${input.startMs ? Prisma.sql`AND pr.created_at >= ${new Date(input.startMs)}` : Prisma.empty}
      ${input.endMs ? Prisma.sql`AND pr.created_at <= ${new Date(input.endMs)}` : Prisma.empty}
    ORDER BY pr.created_at DESC, pr.id DESC
    LIMIT ${input.take} OFFSET ${input.skip}
  `;

  const total = rows[0]?._total ?? 0;
  return { items: rows, total };
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
    SELECT
      pr.id,
      pr.store_id AS "storeId",
      pr.customer_id AS "customerId",
      pr.amount,
      pr.type::text AS "type",
      pr.description,
      pr.created_at AS "createdAt",
      COUNT(*) OVER()::int AS _total
    FROM marketing_points_records pr
    WHERE pr.customer_id = ${customerId}
      ${input.type ? Prisma.sql`AND pr.type = ${input.type}::"MarketingPointsChangeType"` : Prisma.empty}
      ${input.startMs ? Prisma.sql`AND pr.created_at >= ${new Date(input.startMs)}` : Prisma.empty}
      ${input.endMs ? Prisma.sql`AND pr.created_at <= ${new Date(input.endMs)}` : Prisma.empty}
    ORDER BY pr.created_at DESC, pr.id DESC
    LIMIT ${input.take} OFFSET ${input.skip}
  `;

  const total = rows[0]?._total ?? 0;
  return { items: rows, total };
}

export async function queryCustomerConsumptionPage(
  prisma: PrismaService,
  customerId: number,
  skip: number,
  take: number,
): Promise<MarketingConsumptionRow[]> {
  return prisma.$queryRaw<MarketingConsumptionRow[]>`
    SELECT ${CONSUMPTION_COLUMNS}
    ${CONSUMPTION_FROM}
    WHERE co.customer_id = ${customerId}
    ORDER BY co.created_at DESC, co.id DESC
    LIMIT ${take} OFFSET ${skip}
  `;
}

export async function queryConsumptionRowById(
  prisma: PrismaService,
  consumptionId: number,
): Promise<MarketingConsumptionRow | null> {
  const rows = await prisma.$queryRaw<MarketingConsumptionRow[]>`
    SELECT ${CONSUMPTION_COLUMNS}
    ${CONSUMPTION_FROM}
    WHERE co.id = ${consumptionId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function queryPromotionRowById(
  prisma: PrismaService,
  promotionId: number,
): Promise<MarketingPromotionRow | null> {
  const rows = await prisma.$queryRaw<MarketingPromotionRow[]>`
    SELECT
      id,
      store_id AS "storeId",
      name,
      type::text AS "type",
      description,
      params,
      start_at AS "startAt",
      end_at AS "endAt",
      usage_count AS "usageCount",
      total_discount AS "totalDiscount",
      enabled,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM marketing_promotions
    WHERE id = ${promotionId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}
