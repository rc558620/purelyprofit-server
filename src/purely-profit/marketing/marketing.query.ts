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

export async function queryCustomerRowById(
  prisma: PrismaService,
  customerId: number,
): Promise<MarketingCustomerRow | null> {
  const rows = await prisma.$queryRaw<MarketingCustomerRow[]>`
    SELECT
      id,
      store_id AS "storeId",
      name,
      phone,
      avatar,
      tier::text AS "tier",
      balance,
      points,
      total_spent AS "totalSpent",
      visit_count AS "visitCount",
      last_visit_at AS "lastVisitAt",
      remark,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM marketing_customers
    WHERE id = ${customerId}
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
    SELECT
      r.id,
      r.store_id AS "storeId",
      r.customer_id AS "customerId",
      c.name AS "customerName",
      r.amount,
      r.gift_amount AS "giftAmount",
      r.type::text AS "type",
      r.promotion_id AS "promotionId",
      p.name AS "promotionName",
      r.note,
      r.created_at AS "createdAt"
    FROM marketing_recharges r
    JOIN marketing_customers c ON c.id = r.customer_id
    LEFT JOIN marketing_promotions p ON p.id = r.promotion_id
    WHERE r.customer_id = ${customerId}
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
    SELECT
      co.id,
      co.store_id AS "storeId",
      co.customer_id AS "customerId",
      c.name AS "customerName",
      co.amount,
      co.balance_paid AS "balancePaid",
      co.points_deducted AS "pointsDeducted",
      co.pay_type::text AS "payType",
      co.items_summary AS "itemsSummary",
      co.promotion_id AS "promotionId",
      p.name AS "promotionName",
      co.created_at AS "createdAt"
    FROM marketing_consumptions co
    JOIN marketing_customers c ON c.id = co.customer_id
    LEFT JOIN marketing_promotions p ON p.id = co.promotion_id
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
    SELECT
      r.id,
      r.store_id AS "storeId",
      r.customer_id AS "customerId",
      c.name AS "customerName",
      r.amount,
      r.gift_amount AS "giftAmount",
      r.type::text AS "type",
      r.promotion_id AS "promotionId",
      p.name AS "promotionName",
      r.note,
      r.created_at AS "createdAt"
    FROM marketing_recharges r
    JOIN marketing_customers c ON c.id = r.customer_id
    LEFT JOIN marketing_promotions p ON p.id = r.promotion_id
    WHERE r.store_id = ${input.storeId}
      ${input.customerId ? Prisma.sql`AND r.customer_id = ${input.customerId}` : Prisma.empty}
      ${input.startMs ? Prisma.sql`AND r.created_at >= ${new Date(input.startMs)}` : Prisma.empty}
      ${input.endMs ? Prisma.sql`AND r.created_at <= ${new Date(input.endMs)}` : Prisma.empty}
    ORDER BY r.created_at DESC
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
    SELECT
      r.id,
      r.store_id AS "storeId",
      r.customer_id AS "customerId",
      c.name AS "customerName",
      r.amount,
      r.gift_amount AS "giftAmount",
      r.type::text AS "type",
      r.promotion_id AS "promotionId",
      p.name AS "promotionName",
      r.note,
      r.created_at AS "createdAt"
    FROM marketing_recharges r
    JOIN marketing_customers c ON c.id = r.customer_id
    LEFT JOIN marketing_promotions p ON p.id = r.promotion_id
    WHERE r.customer_id = ${customerId}
    ORDER BY r.created_at DESC
    LIMIT ${take} OFFSET ${skip}
  `;
}

export async function queryRechargeRowById(
  prisma: PrismaService,
  rechargeId: number,
): Promise<MarketingRechargeRow | null> {
  const rows = await prisma.$queryRaw<MarketingRechargeRow[]>`
    SELECT
      r.id,
      r.store_id AS "storeId",
      r.customer_id AS "customerId",
      c.name AS "customerName",
      r.amount,
      r.gift_amount AS "giftAmount",
      r.type::text AS "type",
      r.promotion_id AS "promotionId",
      p.name AS "promotionName",
      r.note,
      r.created_at AS "createdAt"
    FROM marketing_recharges r
    JOIN marketing_customers c ON c.id = r.customer_id
    LEFT JOIN marketing_promotions p ON p.id = r.promotion_id
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
    SELECT
      co.id,
      co.store_id AS "storeId",
      co.customer_id AS "customerId",
      c.name AS "customerName",
      co.amount,
      co.balance_paid AS "balancePaid",
      co.points_deducted AS "pointsDeducted",
      co.pay_type::text AS "payType",
      co.items_summary AS "itemsSummary",
      co.promotion_id AS "promotionId",
      p.name AS "promotionName",
      co.created_at AS "createdAt"
    FROM marketing_consumptions co
    JOIN marketing_customers c ON c.id = co.customer_id
    LEFT JOIN marketing_promotions p ON p.id = co.promotion_id
    WHERE co.customer_id = ${customerId}
    ORDER BY co.created_at DESC
    LIMIT ${take} OFFSET ${skip}
  `;
}

export async function queryConsumptionRowById(
  prisma: PrismaService,
  consumptionId: number,
): Promise<MarketingConsumptionRow | null> {
  const rows = await prisma.$queryRaw<MarketingConsumptionRow[]>`
    SELECT
      co.id,
      co.store_id AS "storeId",
      co.customer_id AS "customerId",
      c.name AS "customerName",
      co.amount,
      co.balance_paid AS "balancePaid",
      co.points_deducted AS "pointsDeducted",
      co.pay_type::text AS "payType",
      co.items_summary AS "itemsSummary",
      co.promotion_id AS "promotionId",
      p.name AS "promotionName",
      co.created_at AS "createdAt"
    FROM marketing_consumptions co
    JOIN marketing_customers c ON c.id = co.customer_id
    LEFT JOIN marketing_promotions p ON p.id = co.promotion_id
    WHERE co.id = ${consumptionId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function queryPromotionRowById(
  prisma: PrismaService,
  promotionId: number,
): Promise<MarketingPromotionRow | null> {
  const promotion = await prisma.marketingPromotion.findUnique({
    where: { id: promotionId },
  });

  return promotion as MarketingPromotionRow | null;
}
