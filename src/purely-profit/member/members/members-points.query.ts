import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MemberRecord } from './members.mapper';
import type {
  MemberBeanLogRecord,
  MemberPointsLogRecord,
} from './members-points.mapper';
import { MEMBER_RETURNING_SQL, requireMemberRow } from './members-query.shared';
import {
  createMemberAssetLogsQueryConfig,
  queryConfiguredMemberAssetLogs,
  queryConfiguredMemberAssetOverview,
} from './members-points.shared';
import type {
  ApplyMemberBeansAdjustmentInput,
  ApplyMemberPointsAdjustmentInput,
  MemberAssetLogsQueryConfig,
  MemberAssetOverviewQueryConfig,
  MemberBeansOverviewRow,
  MemberPointsOverviewRow,
  QueryMemberBeanLogsInput,
  QueryMemberPointsLogsInput,
} from './members.types';

interface MemberAssetQueryConfig<TType, TSource> {
  overview: MemberAssetOverviewQueryConfig;
  logs: MemberAssetLogsQueryConfig<TType, TSource>;
}

const POINTS_MEMBER_ASSET_QUERY_CONFIG: MemberAssetQueryConfig<
  QueryMemberPointsLogsInput['type'],
  QueryMemberPointsLogsInput['source']
> = {
  overview: {
    selectSql: Prisma.sql`
      COUNT(*)::int AS "totalCount",
      COUNT(*) FILTER (
        WHERE source = 'admin_adjust'::"MemberPointsSource"
      )::int AS "adminAdjustCount",
      COUNT(*) FILTER (
        WHERE created_at >= DATE_TRUNC('day', NOW())
      )::int AS "todayChangeCount"
    `,
    fromSql: Prisma.sql`FROM member_points_logs`,
  },
  logs: createMemberAssetLogsQueryConfig({
    selectSql: Prisma.sql`
      l.id,
      l.member_id AS "memberId",
      m.name AS "memberName",
      m.phone AS "memberPhone",
      CASE
        WHEN l.source = 'expire'::"MemberPointsSource" THEN -l.change_amount
        WHEN l.change_type = 'INCREASE' THEN l.change_amount
        ELSE -l.change_amount
      END AS amount,
      l.source::text AS source,
      l.reason AS description,
      l.created_at AS "createdAt",
      l.expires_at AS "expireAt"
    `,
    fromSql: Prisma.sql`
      FROM member_points_logs l
      JOIN members m ON m.id = l.member_id
    `,
    whereClause: {
      buildTypeFilters: (type) => {
        switch (type) {
          case 'earn':
            return [
              Prisma.sql`l.source <> 'expire'::"MemberPointsSource" AND l.change_type = 'INCREASE'`,
            ];
          case 'spend':
            return [
              Prisma.sql`l.source <> 'expire'::"MemberPointsSource" AND l.change_type = 'DECREASE'`,
            ];
          case 'expire':
            return [Prisma.sql`l.source = 'expire'::"MemberPointsSource"`];
          default:
            return [];
        }
      },
      buildSourceFilter: (source) =>
        Prisma.sql`l.source = ${source}::"MemberPointsSource"`,
      buildKeywordFilter: (keyword) => Prisma.sql`(
        m.name ILIKE ${`%${keyword}%`}
        OR m.phone LIKE ${`%${keyword}%`}
        OR l.reason ILIKE ${`%${keyword}%`}
      )`,
    },
  }),
};

const BEANS_MEMBER_ASSET_QUERY_CONFIG: MemberAssetQueryConfig<
  QueryMemberBeanLogsInput['type'],
  QueryMemberBeanLogsInput['source']
> = {
  overview: {
    selectSql: Prisma.sql`
      COUNT(*)::int AS "totalCount",
      COUNT(*) FILTER (
        WHERE source = 'admin_adjust'::"MemberBeanSource"
      )::int AS "adminAdjustCount",
      COUNT(*) FILTER (
        WHERE source = 'promo_reward'::"MemberBeanSource"
      )::int AS "promoRewardCount",
      COUNT(*) FILTER (
        WHERE source = 'withdrawal'::"MemberBeanSource"
      )::int AS "withdrawCount"
    `,
    fromSql: Prisma.sql`FROM member_bean_logs`,
  },
  logs: createMemberAssetLogsQueryConfig({
    selectSql: Prisma.sql`
      l.id,
      l.member_id AS "memberId",
      m.name AS "memberName",
      m.phone AS "memberPhone",
      l.change_amount AS amount,
      l.source::text AS source,
      l.reason AS description,
      l.related_promo_id AS "relatedPromoId",
      l.related_user AS "relatedUser",
      l.created_at AS "createdAt"
    `,
    fromSql: Prisma.sql`
      FROM member_bean_logs l
      JOIN members m ON m.id = l.member_id
    `,
    whereClause: {
      buildTypeFilters: (type) => {
        switch (type) {
          case 'earn':
            return [Prisma.sql`l.change_amount > 0`];
          case 'spend':
            return [
              Prisma.sql`l.change_amount < 0 AND l.source <> 'withdrawal'::"MemberBeanSource"`,
            ];
          case 'withdraw':
            return [Prisma.sql`l.source = 'withdrawal'::"MemberBeanSource"`];
          default:
            return [];
        }
      },
      buildSourceFilter: (source) =>
        Prisma.sql`l.source = ${source}::"MemberBeanSource"`,
      buildKeywordFilter: (keyword) => Prisma.sql`(
        m.name ILIKE ${`%${keyword}%`}
        OR m.phone LIKE ${`%${keyword}%`}
        OR l.reason ILIKE ${`%${keyword}%`}
        OR COALESCE(l.related_user, '') ILIKE ${`%${keyword}%`}
      )`,
    },
  }),
};

function requirePointsLogRow(
  log?: MemberPointsLogRecord,
): MemberPointsLogRecord {
  if (!log) {
    throw new ConflictException('积分记录写入失败，请稍后重试');
  }

  return log;
}

function requireBeanLogRow(log?: MemberBeanLogRecord): MemberBeanLogRecord {
  if (!log) {
    throw new ConflictException('纯利豆记录写入失败，请稍后重试');
  }

  return log;
}

export async function queryMemberPointsOverview(
  prisma: PrismaService,
  storeId: number,
): Promise<MemberPointsOverviewRow | null> {
  return queryConfiguredMemberAssetOverview(
    prisma,
    storeId,
    POINTS_MEMBER_ASSET_QUERY_CONFIG.overview,
  );
}

export async function queryMemberPointsLogs(
  prisma: PrismaService,
  params: QueryMemberPointsLogsInput,
): Promise<{ items: MemberPointsLogRecord[]; total: number }> {
  return queryConfiguredMemberAssetLogs(
    prisma,
    params,
    POINTS_MEMBER_ASSET_QUERY_CONFIG.logs,
  );
}

export async function applyMemberPointsAdjustment(
  client: Prisma.TransactionClient,
  params: ApplyMemberPointsAdjustmentInput,
): Promise<{ member: MemberRecord; log: MemberPointsLogRecord }> {
  const memberRows = await client.$queryRaw<MemberRecord[]>`
    UPDATE members
    SET
      points = ${params.afterPoints},
      total_points_earned = total_points_earned + ${params.delta > 0 ? params.delta : 0},
      updated_at = NOW()
    WHERE id = ${params.member.id}
    ${MEMBER_RETURNING_SQL}
  `;
  const logRows = await client.$queryRaw<MemberPointsLogRecord[]>`
    INSERT INTO member_points_logs (
      member_id,
      store_id,
      operator_staff_id,
      change_type,
      source,
      change_amount,
      before_points,
      after_points,
      reason
    )
    VALUES (
      ${params.member.id},
      ${params.member.storeId},
      ${params.operatorStaffId},
      ${params.delta > 0 ? 'INCREASE' : 'DECREASE'}::"MemberPointsChangeType",
      'admin_adjust'::"MemberPointsSource",
      ${Math.abs(params.delta)},
      ${params.beforePoints},
      ${params.afterPoints},
      ${params.reason}
    )
    RETURNING
      id,
      member_id AS "memberId",
      ${params.member.name}::text AS "memberName",
      ${params.member.phone}::text AS "memberPhone",
      ${params.delta}::int AS amount,
      source::text AS source,
      reason AS description,
      created_at AS "createdAt",
      expires_at AS "expireAt"
  `;

  return {
    member: requireMemberRow(memberRows[0]),
    log: requirePointsLogRow(logRows[0]),
  };
}

export async function queryMemberBeansOverview(
  prisma: PrismaService,
  storeId: number,
): Promise<MemberBeansOverviewRow | null> {
  return queryConfiguredMemberAssetOverview(
    prisma,
    storeId,
    BEANS_MEMBER_ASSET_QUERY_CONFIG.overview,
  );
}

export async function queryMemberBeanLogs(
  prisma: PrismaService,
  params: QueryMemberBeanLogsInput,
): Promise<{ items: MemberBeanLogRecord[]; total: number }> {
  return queryConfiguredMemberAssetLogs(
    prisma,
    params,
    BEANS_MEMBER_ASSET_QUERY_CONFIG.logs,
  );
}

export async function applyMemberBeansAdjustment(
  client: Prisma.TransactionClient,
  params: ApplyMemberBeansAdjustmentInput,
): Promise<{ member: MemberRecord; log: MemberBeanLogRecord }> {
  const memberRows = await client.$queryRaw<MemberRecord[]>`
    UPDATE members
    SET
      bean_balance = ${params.afterBalance},
      updated_at = NOW()
    WHERE id = ${params.member.id}
    ${MEMBER_RETURNING_SQL}
  `;
  const logRows = await client.$queryRaw<MemberBeanLogRecord[]>`
    INSERT INTO member_bean_logs (
      member_id,
      store_id,
      operator_staff_id,
      source,
      change_amount,
      before_balance,
      after_balance,
      reason
    )
    VALUES (
      ${params.member.id},
      ${params.member.storeId},
      ${params.operatorStaffId},
      'admin_adjust'::"MemberBeanSource",
      ${params.delta},
      ${params.beforeBalance},
      ${params.afterBalance},
      ${params.reason}
    )
    RETURNING
      id,
      member_id AS "memberId",
      ${params.member.name}::text AS "memberName",
      ${params.member.phone}::text AS "memberPhone",
      change_amount AS amount,
      source::text AS source,
      reason AS description,
      related_promo_id AS "relatedPromoId",
      related_user AS "relatedUser",
      created_at AS "createdAt"
  `;

  return {
    member: requireMemberRow(memberRows[0]),
    log: requireBeanLogRow(logRows[0]),
  };
}
