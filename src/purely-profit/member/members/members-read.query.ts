import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { type MemberRecord, type MemberRechargeRecord } from './members.mapper';
import { buildStoreIdWhereClause } from './members-query.shared';
import type {
  MemberLevelMetaRow,
  MemberOverviewRow,
  MemberSnapshotRow,
  MemberSnapshotsQueryInput,
  MemberStatusMetaRow,
} from './members.types';
import type { MemberStatusDb } from './members.utils';

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
    // level 已从 members 表删除，改为从 MarketingCustomer.tier 过滤
    // 映射规则：free→regular, monthly→regular, quarterly→gold, annual→diamond
    const tierMap: Record<string, string> = {
      free: 'regular',
      monthly: 'regular',
      quarterly: 'gold',
      annual: 'diamond',
    };
    const tier = tierMap[level.toLowerCase()] ?? level.toLowerCase();
    filters.push(Prisma.sql`LOWER(mc.tier::text) = ${tier}`);
  }

  if (onlyPartners) {
    filters.push(Prisma.sql`m.is_partner = true`);
  }

  if (keyword) {
    filters.push(
      Prisma.sql`(
        m.name ILIKE ${`%${keyword}%`}
        OR m.phone LIKE ${`%${keyword}%`}
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
        OR m.phone LIKE ${`%${keyword}%`}
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
        CASE mc.tier::text
          WHEN 'diamond' THEN 'annual'
          WHEN 'gold' THEN 'quarterly'
          ELSE 'free'
        END AS value,
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
