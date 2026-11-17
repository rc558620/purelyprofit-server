/**
 * 账号合并的批量写语句。
 *
 * 合并时「同一门店双方都有档案」的每一对都要做两件事：
 * 1. 把源档案的资产（纯利豆 / 储值 / 积分 / 累计消费 / 到店次数）加到目标档案；
 * 2. 软删除源档案并清空归属列（phone / club_user_id）。
 *
 * 原实现按门店逐条 `update`，一条 2 次往返、事务时长随门店数线性增长；
 * 账号合并本身就带着 `TX_TIMEOUT_LONG`，门店一多就容易踩超时。
 * 这里改成「每类操作一条集合 UPDATE」，语句数与门店数无关。
 *
 * 为什么用原生 SQL：Prisma 的 `updateMany` 只能给所有命中行同一个 data，
 * 而每个目标档案要加上**各自**源档案的资产额，只能靠 `VALUES` 逐行对齐。
 * 全部参数走 `Prisma.sql` 参数化，不做字符串拼接。
 */
import { Prisma } from '@prisma/client';

/** 需要并入目标的 Member 对（豆结转 + 软删） */
export interface MemberMergePair {
  /** 目标 Member（保留） */
  targetId: number;
  /** 源 Member（软删） */
  sourceId: number;
  /** 源 Member 待结转的纯利豆 */
  beanBalance: number;
}

/** 需要并入目标的 MarketingCustomer 对（资产结转 + 软删） */
export interface CustomerMergePair {
  targetId: number;
  sourceId: number;
  balance: number;
  points: number;
  totalSpent: number;
  visitCount: number;
}

const toUpdatedAtUtc = Prisma.sql`"updated_at" = NOW() AT TIME ZONE 'UTC'`;

/**
 * Member：豆结转 1 条 + 软删 1 条。
 *
 * > 纯利豆为 0 的源档案不参与结转（与改造前 `if (beanBalance > 0)` 一致），
 * > 避免无意义的行更新与 updated_at 抖动。
 */
export function buildMemberMergeStatements(
  pairs: readonly MemberMergePair[],
  now: Date,
): Prisma.Sql[] {
  if (pairs.length === 0) return [];

  const statements: Prisma.Sql[] = [];
  const funded = pairs.filter((pair) => pair.beanBalance > 0);
  if (funded.length > 0) {
    statements.push(Prisma.sql`
      UPDATE "members" AS m
      SET "bean_balance" = m."bean_balance" + v."bean_balance",
          ${toUpdatedAtUtc}
      FROM (VALUES ${Prisma.join(
        funded.map(
          (pair) =>
            Prisma.sql`(${pair.targetId}::int, ${pair.beanBalance}::int)`,
        ),
      )}) AS v("id", "bean_balance")
      WHERE m."id" = v."id"
    `);
  }

  statements.push(Prisma.sql`
    UPDATE "members"
    SET "phone" = NULL,
        "deleted_at" = ${now},
        ${toUpdatedAtUtc}
    WHERE "id" IN (${Prisma.join(pairs.map((pair) => pair.sourceId))})
  `);

  return statements;
}

/** MarketingCustomer：资产结转 1 条 + 软删 1 条。 */
export function buildCustomerMergeStatements(
  pairs: readonly CustomerMergePair[],
  now: Date,
): Prisma.Sql[] {
  if (pairs.length === 0) return [];

  return [
    Prisma.sql`
      UPDATE "marketing_customers" AS c
      SET "balance" = c."balance" + v."balance",
          "points" = c."points" + v."points",
          "total_spent" = c."total_spent" + v."total_spent",
          "visit_count" = c."visit_count" + v."visit_count",
          ${toUpdatedAtUtc}
      FROM (VALUES ${Prisma.join(
        pairs.map(
          (pair) =>
            Prisma.sql`(${pair.targetId}::int, ${pair.balance}::int, ${pair.points}::int, ${pair.totalSpent}::int, ${pair.visitCount}::int)`,
        ),
      )}) AS v("id", "balance", "points", "total_spent", "visit_count")
      WHERE c."id" = v."id"
    `,
    Prisma.sql`
      UPDATE "marketing_customers"
      SET "club_user_id" = NULL,
          "phone" = NULL,
          "deleted_at" = ${now},
          ${toUpdatedAtUtc}
      WHERE "id" IN (${Prisma.join(pairs.map((pair) => pair.sourceId))})
    `,
  ];
}
