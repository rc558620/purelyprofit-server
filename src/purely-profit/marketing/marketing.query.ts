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

/**
 * 基于时间线遍历计算顾客当前赠送金额余额（分）。
 *
 * 算法规则：
 * - 充值/赠送：trackedGift += giftAmount
 * - 退款：trackedGift = 0（任何退款均清零赠送，清零后新充值赠送重新累计）
 *
 * @param prisma  PrismaService 或事务客户端（Prisma.TransactionClient）
 * @param customerId  顾客 ID
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function queryCustomerGiftBalanceCents(
  prisma: any,
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
      // 任何退款均清零赠送金额，清零后新充值赠送重新累计
      trackedGift = 0;
    }
  }

  // 退款清零后，trackedGift 仅包含清零后新充值的赠送金额
  // 不再扣减历史消费（消费发生在清零前，不应影响清零后的新赠送）
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
      r.total_amount AS "totalAmount",
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
      r.total_amount AS "totalAmount",
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
    SELECT
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
    FROM marketing_recharges r
    JOIN marketing_customers c ON c.id = r.customer_id
    LEFT JOIN marketing_promotions p ON p.id = r.promotion_id
    WHERE r.customer_id = ${customerId}
    ORDER BY r.created_at DESC, r.id DESC
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
      r.total_amount AS "totalAmount",
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
    ORDER BY co.created_at DESC, co.id DESC
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
