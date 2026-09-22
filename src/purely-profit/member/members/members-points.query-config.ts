import { Prisma } from '@prisma/client';
import { createMemberAssetLogsQueryConfig } from './members-points.shared';
import type {
  MemberAssetLogsQueryConfig,
  MemberAssetOverviewQueryConfig,
  QueryMemberBeanLogsInput,
  QueryMemberPointsLogsInput,
} from './members.types';

interface MemberAssetQueryConfig<TType, TSource> {
  overview: MemberAssetOverviewQueryConfig;
  logs: MemberAssetLogsQueryConfig<TType, TSource>;
}

export const POINTS_MEMBER_ASSET_QUERY_CONFIG: MemberAssetQueryConfig<
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
        -- «今日»按业务时区取日界，但 created_at 存的是 UTC 墙钟（naive 列统一口径），
        -- 因此要先把业务时区日界转回真实瞬间、再转成 UTC 墙钟才能比较
        WHERE created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE ${timezone})
          AT TIME ZONE ${timezone} AT TIME ZONE 'UTC'
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
        OR m.phone ILIKE ${`%${keyword}%`}
        OR l.reason ILIKE ${`%${keyword}%`}
      )`,
    },
  }),
};

export const BEANS_MEMBER_ASSET_QUERY_CONFIG: MemberAssetQueryConfig<
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
        OR m.phone ILIKE ${`%${keyword}%`}
        OR l.reason ILIKE ${`%${keyword}%`}
        OR COALESCE(l.related_user, '') ILIKE ${`%${keyword}%`}
      )`,
    },
  }),
};
