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
  const filters: Prisma.Sql[] = [buildStoreIdWhereClause(storeId)];

  if (status) {
    filters.push(Prisma.sql`status = ${status}::"MemberStatus"`);
  }

  if (level) {
    filters.push(Prisma.sql`LOWER(level) = LOWER(${level})`);
  }

  if (onlyPartners) {
    filters.push(Prisma.sql`is_partner = true`);
  }

  if (keyword) {
    filters.push(
      Prisma.sql`(
        name ILIKE ${`%${keyword}%`}
        OR phone LIKE ${`%${keyword}%`}
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
  const filters: Prisma.Sql[] = [buildStoreIdWhereClause(storeId)];

  if (onlyPartners) {
    filters.push(Prisma.sql`is_partner = true`);
  }

  if (keyword) {
    filters.push(
      Prisma.sql`(
        name ILIKE ${`%${keyword}%`}
        OR phone LIKE ${`%${keyword}%`}
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
      updated_at AS "updatedAt",
      COUNT(*) OVER()::int AS _total
    FROM members
    WHERE ${whereClause}
    ORDER BY updated_at DESC, id DESC
    OFFSET ${params.skip}
    LIMIT ${params.take}
  `;

  const total = rows[0]?._total ?? 0;
  const items: MemberRecord[] = rows;

  return { items, total };
}

export async function queryMembersMeta(
  prisma: PrismaService,
  storeId: number,
): Promise<{
  levelRows: MemberLevelMetaRow[];
  statusRows: MemberStatusMetaRow[];
}> {
  const whereClause = buildStoreIdWhereClause(storeId);
  const [levelRows, statusRows] = await Promise.all([
    prisma.$queryRaw<MemberLevelMetaRow[]>`
      SELECT level AS value, COUNT(*)::int AS count
      FROM members
      WHERE ${whereClause}
      GROUP BY level
      ORDER BY count DESC, value ASC
    `,
    prisma.$queryRaw<MemberStatusMetaRow[]>`
      SELECT status AS value, COUNT(*)::int AS count
      FROM members
      WHERE ${whereClause}
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
  const whereClause = buildStoreIdWhereClause(storeId);
  const rows = await prisma.$queryRaw<MemberOverviewRow[]>`
    SELECT
      COUNT(*)::int AS "totalCount",
      COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS "activeCount",
      COUNT(*) FILTER (WHERE is_partner = true)::int AS "partnerCount",
      COUNT(*) FILTER (WHERE status = 'BANNED')::int AS "bannedCount"
    FROM members
    WHERE ${whereClause}
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
      id,
      name,
      phone,
      points,
      bean_balance AS "beanBalance",
      is_partner AS "isPartner"
    FROM members
    WHERE ${whereClause}
    ORDER BY is_partner DESC, updated_at DESC, id DESC
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
