import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MemberRecord } from './members.mapper';

export const MEMBER_SELECT_SQL = Prisma.sql`
  SELECT
    id,
    store_id AS "storeId",
    name,
    phone,
    gender,
    level,
    note,
    birthday,
    last_consume_at AS "lastConsumeAt",
    points,
    total_points_earned AS "totalPointsEarned",
    bean_balance AS "beanBalance",
    is_partner AS "isPartner",
    partner_level AS "partnerLevel",
    total_recharged AS "totalRecharged",
    recharge_count AS "rechargeCount",
    invited_count AS "invitedCount",
    banned_reason AS "bannedReason",
    status,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM members
`;

export const MEMBER_RETURNING_SQL = Prisma.sql`
  RETURNING
    id,
    store_id AS "storeId",
    name,
    phone,
    gender,
    level,
    note,
    birthday,
    last_consume_at AS "lastConsumeAt",
    points,
    total_points_earned AS "totalPointsEarned",
    bean_balance AS "beanBalance",
    is_partner AS "isPartner",
    partner_level AS "partnerLevel",
    total_recharged AS "totalRecharged",
    recharge_count AS "rechargeCount",
    invited_count AS "invitedCount",
    banned_reason AS "bannedReason",
    status,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
`;

export function requireMemberRow(member?: MemberRecord): MemberRecord {
  if (!member) {
    throw new ConflictException('会员数据读取失败，请稍后重试');
  }

  return member;
}

export function buildStoreIdWhereClause(storeId: number): Prisma.Sql {
  return Prisma.sql`store_id = ${storeId}`;
}
