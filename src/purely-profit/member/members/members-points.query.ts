import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MemberRecord } from './members.mapper';
import type {
  MemberBeanLogRecord,
  MemberPointsLogRecord,
} from './members-points.mapper';
import {
  MEMBER_SELECT_BY_ID_SQL,
  requireMemberRow,
} from './members-query.shared';
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
    selectSql: (timezone: string) => Prisma.sql`
      COUNT(*)::int AS "totalCount",
      COUNT(*) FILTER (
        WHERE source = 'admin_adjust'::"MemberPointsSource"
      )::int AS "adminAdjustCount",
      COUNT(*) FILTER (
        WHERE created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE ${timezone})
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
        WHEN l.change_type = 'increase' THEN l.change_amount
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
              Prisma.sql`l.source <> 'expire'::"MemberPointsSource" AND l.change_type = 'increase'`,
            ];
          case 'spend':
            return [
              Prisma.sql`l.source <> 'expire'::"MemberPointsSource" AND l.change_type = 'decrease'`,
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
    selectSql: () => Prisma.sql`
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
  timezone: string,
): Promise<MemberPointsOverviewRow | null> {
  return queryConfiguredMemberAssetOverview(
    prisma,
    storeId,
    timezone,
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
  // 积分事实源为 marketing_customers。
  // 采用「原子相对更新 + 非负约束」：UPDATE 自带行级写锁，
  // 并发请求串行化，避免 read-modify-write 丢失更新；
  // WHERE points + delta >= 0 保证不会扣成负数（命中约束说明余额不足）。
  const updated = await client.$queryRaw<{ points: number }[]>`
    UPDATE marketing_customers
    SET points = points + ${params.delta}, updated_at = NOW()
    WHERE id = ${params.member.customerId}
      AND points + ${params.delta} >= 0
    RETURNING points
  `;

  if (updated.length === 0) {
    throw new ConflictException(params.insufficientMessage);
  }

  const afterPoints = updated[0].points;
  const beforePoints = afterPoints - params.delta;

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
      reason,
      expires_at
    )
    VALUES (
      ${params.member.id},
      ${params.member.storeId},
      ${params.operatorStaffId},
      ${params.delta > 0 ? 'increase' : 'decrease'}::"MemberPointsChangeType",
      'admin_adjust'::"MemberPointsSource",
      ${Math.abs(params.delta)},
      ${beforePoints},
      ${afterPoints},
      ${params.reason},
      ${params.expireAt ?? null}
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

  // 重查完整记录（含 LEFT JOIN marketing_customers，拿到最新 points）
  const memberRows = await client.$queryRaw<MemberRecord[]>(
    MEMBER_SELECT_BY_ID_SQL(params.member.id),
  );

  return {
    member: requireMemberRow(memberRows[0]),
    log: requirePointsLogRow(logRows[0]),
  };
}

export async function queryMemberBeansOverview(
  prisma: PrismaService,
  storeId: number,
  timezone: string,
): Promise<MemberBeansOverviewRow | null> {
  return queryConfiguredMemberAssetOverview(
    prisma,
    storeId,
    timezone,
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
  // 纯利豆仍保留在 Member 表（独立于营销积分）。
  // 同样采用「原子相对更新 + 非负约束」，避免并发丢失更新与扣成负数。
  const updated = await client.$queryRaw<{ bean_balance: number }[]>`
    UPDATE members
    SET bean_balance = bean_balance + ${params.delta}, updated_at = NOW()
    WHERE id = ${params.member.id}
      AND bean_balance + ${params.delta} >= 0
    RETURNING bean_balance
  `;

  if (updated.length === 0) {
    throw new ConflictException(params.insufficientMessage);
  }

  const afterBalance = updated[0].bean_balance;
  const beforeBalance = afterBalance - params.delta;

  // 重查完整记录（含 LEFT JOIN marketing_customers）
  const memberRows = await client.$queryRaw<MemberRecord[]>(
    MEMBER_SELECT_BY_ID_SQL(params.member.id),
  );
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
      ${beforeBalance},
      ${afterBalance},
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
