import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { type MemberRecord, type MemberRechargeRecord } from './members.mapper';
import {
  buildStoreIdWhereClause,
  MEMBER_LEVEL_CASE_SQL,
} from './members-query.shared';
import type {
  MemberLevelMetaRow,
  MemberOverviewRow,
  MemberSnapshotRow,
  MemberSnapshotsQueryInput,
  MemberStatusMetaRow,
} from './members.types';
import type { MemberStatusDb } from './members.utils';

/** 会员快照单次返回上限（防全表拉取，非分页参数） */
const MEMBER_SNAPSHOTS_MAX_ROWS = 500;

function buildListWhereClause(
  storeId: number,
  status: MemberStatusDb | undefined,
  level: string | undefined,
  keyword: string | undefined,
  onlyPartners: boolean | undefined,
): Prisma.Sql {
  const filters: Prisma.Sql[] = [buildStoreIdWhereClause(storeId, 'm')];
  filters.push(Prisma.sql`m.deleted_at IS NULL`);

  if (status) {
    filters.push(Prisma.sql`m.status = ${status}::"MemberStatus"`);
  }

  if (level) {
    // 直接复用 meta 统计的分组表达式，保证「筛选项命中数」与「实际筛选结果」完全同源。
    // 旧的 tierMap 写法有两个问题：
    //   ① free/monthly 都映射到 regular，两个筛选项返回完全相同的结果集；
    //   ② mc.tier 为 NULL（未关联顾客档案）时条件不成立，这批会员在 meta 里算 free 却筛不出来。
    // ::text 显式标注参数类型，避免 PG 无法推断占位符类型
    filters.push(
      Prisma.sql`${MEMBER_LEVEL_CASE_SQL} = ${level.toLowerCase()}::text`,
    );
  }

  if (onlyPartners) {
    filters.push(Prisma.sql`m.is_partner = true`);
  }

  if (keyword) {
    filters.push(
      Prisma.sql`(
        m.name ILIKE ${`%${keyword}%`}
        OR m.phone ILIKE ${`%${keyword}%`}
      )`,
    );
  }

  return Prisma.join(filters, ' AND ');
}

function buildSnapshotWhereClause(
  storeId: number,
  keyword: string | undefined,
  onlyPartners: boolean | undefined,
): Prisma.Sql {
  const filters: Prisma.Sql[] = [buildStoreIdWhereClause(storeId, 'm')];
  filters.push(Prisma.sql`m.deleted_at IS NULL`);

  if (onlyPartners) {
    filters.push(Prisma.sql`m.is_partner = true`);
  }

  if (keyword) {
    filters.push(
      Prisma.sql`(
        m.name ILIKE ${`%${keyword}%`}
        OR m.phone ILIKE ${`%${keyword}%`}
      )`,
    );
  }

  return Prisma.join(filters, ' AND ');
}

interface MemberRecordWithTotal extends MemberRecord {
  _total: number;
}

export async function queryMembersPage(
  prisma: PrismaService,
  params: {
    storeId: number;
    status?: MemberStatusDb;
    level?: string;
    keyword?: string;
    onlyPartners?: boolean;
    skip: number;
    take: number;
  },
): Promise<{ items: MemberRecord[]; total: number }> {
  const whereClause = buildListWhereClause(
    params.storeId,
    params.status,
    params.level,
    params.keyword,
    params.onlyPartners,
  );

  const rows = await prisma.$queryRaw<MemberRecordWithTotal[]>`
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
      ELSE NULL END AS "customer",
      COUNT(*) OVER()::int AS "_total"
    FROM members m
    LEFT JOIN marketing_customers mc ON mc.id = m.customer_id
      AND mc.deleted_at IS NULL
    WHERE ${whereClause}
    ORDER BY m.updated_at DESC, m.id DESC
    OFFSET ${params.skip}
    LIMIT ${params.take}
  `;

  const total = rows[0]?._total ?? 0;
  const items: MemberRecord[] = rows.map(({ _total: _t, ...row }) => row);

  return { items, total };
}

export async function queryMembersMeta(
  prisma: PrismaService,
  storeId: number,
): Promise<{
  levelRows: MemberLevelMetaRow[];
  statusRows: MemberStatusMetaRow[];
}> {
  // level 字段已删除，改为从 MarketingCustomer.tier 聚合
  // tier → MemberLevel 映射：regular→free, gold→quarterly, diamond→annual
  const [levelRows, statusRows] = await Promise.all([
    prisma.$queryRaw<MemberLevelMetaRow[]>`
      SELECT
        ${MEMBER_LEVEL_CASE_SQL} AS value,
        COUNT(*)::int AS count
      FROM members m
      LEFT JOIN marketing_customers mc ON mc.id = m.customer_id
        AND mc.deleted_at IS NULL
      WHERE m.store_id = ${storeId}
        AND m.deleted_at IS NULL
      GROUP BY 1
      ORDER BY count DESC, value ASC
    `,
    prisma.$queryRaw<MemberStatusMetaRow[]>`
      SELECT status AS value, COUNT(*)::int AS count
      FROM members
      WHERE store_id = ${storeId}
        AND deleted_at IS NULL
      GROUP BY status
    `,
  ]);

  return {
    levelRows,
    statusRows,
  };
}

export async function queryMembersOverview(
  prisma: PrismaService,
  storeId: number,
): Promise<MemberOverviewRow | null> {
  const rows = await prisma.$queryRaw<MemberOverviewRow[]>`
    SELECT
      COUNT(*)::int AS "totalCount",
      COUNT(*) FILTER (WHERE status = 'active')::int AS "activeCount",
      COUNT(*) FILTER (WHERE is_partner = true)::int AS "partnerCount",
      COUNT(*) FILTER (WHERE status = 'banned')::int AS "bannedCount"
    FROM members
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
  `;

  return rows[0] ?? null;
}

export async function queryMemberSnapshots(
  prisma: PrismaService,
  params: MemberSnapshotsQueryInput & { storeId: number },
): Promise<MemberSnapshotRow[]> {
  const whereClause = buildSnapshotWhereClause(
    params.storeId,
    params.keyword,
    params.onlyPartners,
  );

  // 快照是「积分/纯利豆调整弹窗」的会员选择器数据源，本来就是有限候选集；
  // 加硬上限兜底，避免会员量增长后一次性把整张表拉进内存。
  return prisma.$queryRaw<MemberSnapshotRow[]>`
    SELECT
      m.id,
      m.name,
      m.phone,
      COALESCE(mc.points, 0)::int AS points,
      m.bean_balance AS "beanBalance",
      m.is_partner AS "isPartner"
    FROM members m
    LEFT JOIN marketing_customers mc ON mc.id = m.customer_id
      AND mc.deleted_at IS NULL
    WHERE ${whereClause}
    ORDER BY m.is_partner DESC, m.updated_at DESC, m.id DESC
    LIMIT ${MEMBER_SNAPSHOTS_MAX_ROWS}
  `;
}

export async function queryMemberRechargeHistory(
  prisma: PrismaService,
  memberId: number,
): Promise<MemberRechargeRecord[]> {
  return prisma.$queryRaw<MemberRechargeRecord[]>`
    SELECT
      id,
      plan_name AS "planName",
      amount,
      points_awarded AS "pointsAwarded",
      channel,
      created_at AS "createdAt"
    FROM member_recharge_logs
    WHERE member_id = ${memberId}
    ORDER BY created_at DESC, id DESC
  `;
}

interface MemberRechargeRow extends MemberRechargeRecord {
  memberId: number;
}

/**
 * 批量查询多个会员的充值记录（一次 SQL，避免列表页 N+1）。
 * 返回 memberId → 记录列表（按 created_at DESC, id DESC 排序），无记录的会员不在 map 中。
 */
export async function queryMemberRechargeHistories(
  prisma: PrismaService,
  memberIds: number[],
): Promise<Map<number, MemberRechargeRecord[]>> {
  if (memberIds.length === 0) {
    return new Map();
  }

  const rows = await prisma.$queryRaw<MemberRechargeRow[]>`
    SELECT
      id,
      member_id AS "memberId",
      plan_name AS "planName",
      amount,
      points_awarded AS "pointsAwarded",
      channel,
      created_at AS "createdAt"
    FROM member_recharge_logs
    WHERE member_id IN (${Prisma.join(memberIds)})
    ORDER BY created_at DESC, id DESC
  `;

  const grouped = new Map<number, MemberRechargeRecord[]>();
  for (const row of rows) {
    const records = grouped.get(row.memberId);
    const record: MemberRechargeRecord = {
      id: row.id,
      planName: row.planName,
      amount: row.amount,
      pointsAwarded: row.pointsAwarded,
      channel: row.channel,
      createdAt: row.createdAt,
    };

    if (records) {
      records.push(record);
    } else {
      grouped.set(row.memberId, [record]);
    }
  }

  return grouped;
}
