import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MemberRecord } from './members.mapper';

/**
 * 查询会员记录的标准 SELECT（含 LEFT JOIN marketing_customers 获取运行态字段）
 *
 * - 运行态字段（tier / points / total_spent / visit_count / last_visit_at / balance）
 *   来自 MarketingCustomer（单一事实源）
 * - 纯利豆（bean_balance）保留在 members 表
 */
export const MEMBER_SELECT_SQL = Prisma.sql`
  SELECT
    m.id,
    m.store_id AS "storeId",
    m.customer_id AS "customerId",
    m.name,
    m.phone,
    m.gender,
    m.note,
    m.birthday,
    m.bean_balance AS "beanBalance",
    m.is_partner AS "isPartner",
    m.partner_level AS "partnerLevel",
    m.banned_reason AS "bannedReason",
    m.status,
    m.created_at AS "createdAt",
    m.updated_at AS "updatedAt",
    CASE WHEN mc.id IS NOT NULL THEN
      jsonb_build_object(
        'id', mc.id,
        'tier', mc.tier::text,
        'points', mc.points,
        'totalSpent', mc.total_spent,
        'visitCount', mc.visit_count,
        'lastVisitAt', mc.last_visit_at,
        'balance', mc.balance
      )
    ELSE NULL END AS "customer"
  FROM members m
  LEFT JOIN marketing_customers mc ON mc.id = m.customer_id
    AND mc.deleted_at IS NULL
`;

/**
 * INSERT/UPDATE 后的 RETURNING 子句（含 customer 运行态字段）
 * 用于写操作后立即返回完整记录。
 * 注意：写操作结束后再 JOIN 一次，保证 customer 字段最新。
 */
export const MEMBER_RETURNING_FIELDS_SQL = Prisma.sql`
    id,
    store_id AS "storeId",
    customer_id AS "customerId",
    name,
    phone,
    gender,
    note,
    birthday,
    bean_balance AS "beanBalance",
    is_partner AS "isPartner",
    partner_level AS "partnerLevel",
    banned_reason AS "bannedReason",
    status,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
`;

/** 写操作的 RETURNING（仅返回 member id，后续再 JOIN 获取完整记录） */
export const MEMBER_RETURNING_ID_SQL = Prisma.sql`
  RETURNING id
`;

export function requireMemberRow(member?: MemberRecord): MemberRecord {
  if (!member) {
    throw new ConflictException('会员数据读取失败，请稍后重试');
  }

  return member;
}

export function buildStoreIdWhereClause(
  storeId: number,
  alias: 'm' | 'l' = 'm',
): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(alias)}.store_id = ${storeId}`;
}

/**
 * 通过 member.id 重新查询完整记录（含 customer JOIN）
 * 用于写操作（INSERT/UPDATE）后刷新返回值
 */
export const MEMBER_SELECT_BY_ID_SQL = (id: number): Prisma.Sql => Prisma.sql`
  SELECT
    m.id,
    m.store_id AS "storeId",
    m.customer_id AS "customerId",
    m.name,
    m.phone,
    m.gender,
    m.note,
    m.birthday,
    m.bean_balance AS "beanBalance",
    m.is_partner AS "isPartner",
    m.partner_level AS "partnerLevel",
    m.banned_reason AS "bannedReason",
    m.status,
    m.created_at AS "createdAt",
    m.updated_at AS "updatedAt",
    CASE WHEN mc.id IS NOT NULL THEN
      jsonb_build_object(
        'id', mc.id,
        'tier', mc.tier::text,
        'points', mc.points,
        'totalSpent', mc.total_spent,
        'visitCount', mc.visit_count,
        'lastVisitAt', mc.last_visit_at,
        'balance', mc.balance
      )
    ELSE NULL END AS "customer"
  FROM members m
  LEFT JOIN marketing_customers mc ON mc.id = m.customer_id
    AND mc.deleted_at IS NULL
  WHERE m.id = ${id}
`;
