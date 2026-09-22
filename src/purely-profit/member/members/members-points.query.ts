import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MemberRecord } from './members.mapper';
import type {
  MemberBeanLogRecord,
  MemberPointsLogRecord,
} from './members-points.mapper';
import {
  BEANS_MEMBER_ASSET_QUERY_CONFIG,
  POINTS_MEMBER_ASSET_QUERY_CONFIG,
} from './members-points.query-config';
import {
  MEMBER_SELECT_BY_ID_SQL,
  requireMemberRow,
} from './members-query.shared';
import {
  queryConfiguredMemberAssetLogs,
  queryConfiguredMemberAssetOverview,
} from './members-points.shared';
import type {
  ApplyMemberBeansAdjustmentInput,
  ApplyMemberPointsAdjustmentInput,
  MemberBeansOverviewRow,
  MemberPointsOverviewRow,
  QueryMemberBeanLogsInput,
  QueryMemberPointsLogsInput,
} from './members.types';

/**
 * 判断目标行是否「不存在或已被软删」。
 *
 * 资产调整的条件更新加了 deleted_at IS NULL 之后，0 行受影响既可能是余额不足、
 * 也可能是记录已被删除。只在失败分支查一次（正常路径无额外开销），
 * 用于把「记录没了」和「余额不够」区分开，避免给出误导性提示。
 */
async function isSoftDeleted(
  client: Prisma.TransactionClient,
  table: 'members' | 'marketing_customers',
  id: number | null,
): Promise<boolean> {
  if (id === null) {
    return true;
  }

  const rows = await client.$queryRaw<Array<{ deletedAt: Date | null }>>`
    SELECT deleted_at AS "deletedAt"
    FROM ${Prisma.raw(table)}
    WHERE id = ${id}
    LIMIT 1
  `;

  const row = rows[0];
  return !row || row.deletedAt !== null;
}

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
    SET points = points + ${params.delta}, updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE id = ${params.member.customerId}
      AND deleted_at IS NULL
      AND points + ${params.delta} >= 0
    RETURNING points
  `;

  if (updated.length === 0) {
    if (
      await isSoftDeleted(
        client,
        'marketing_customers',
        params.member.customerId,
      )
    ) {
      throw new NotFoundException('会员关联的顾客档案不存在或已被删除');
    }
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
      expires_at,
      created_at
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
      ${params.expireAt ?? null},
      -- 该列是 TIMESTAMP WITHOUT TIME ZONE，必须显式写 UTC 墙钟，
      -- 否则走 CURRENT_TIMESTAMP 会取数据库会话时区墙钟，被驱动按 UTC 读成 +8h
      NOW() AT TIME ZONE 'UTC'
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
    SET bean_balance = bean_balance + ${params.delta}, updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE id = ${params.member.id}
      AND deleted_at IS NULL
      AND bean_balance + ${params.delta} >= 0
    RETURNING bean_balance
  `;

  if (updated.length === 0) {
    if (await isSoftDeleted(client, 'members', params.member.id)) {
      throw new NotFoundException('会员不存在或已被删除');
    }
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
      reason,
      created_at
    )
    VALUES (
      ${params.member.id},
      ${params.member.storeId},
      ${params.operatorStaffId},
      'admin_adjust'::"MemberBeanSource",
      ${params.delta},
      ${beforeBalance},
      ${afterBalance},
      ${params.reason},
      NOW() AT TIME ZONE 'UTC'
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

/**
 * 新建会员时补写「初始纯利豆」流水。
 *
 * 建会员接口允许直接给定 beanBalance（DB 里 members.bean_balance 初始值），
 * 若不写流水就会出现「余额凭空出现、查不到来源」的审计缺口。
 * 这里补一条 before=0 的 admin_adjust 流水，与手动调整共用同一张流水表。
 */
export async function insertMemberBeanOpeningLog(
  client: Prisma.TransactionClient,
  params: {
    member: MemberRecord;
    operatorStaffId: number | null;
    reason: string;
  },
): Promise<void> {
  if (params.member.beanBalance <= 0) {
    return;
  }

  await client.$executeRaw`
    INSERT INTO member_bean_logs (
      member_id,
      store_id,
      operator_staff_id,
      source,
      change_amount,
      before_balance,
      after_balance,
      reason,
      created_at
    )
    VALUES (
      ${params.member.id},
      ${params.member.storeId},
      ${params.operatorStaffId},
      'admin_adjust'::"MemberBeanSource",
      ${params.member.beanBalance},
      0,
      ${params.member.beanBalance},
      ${params.reason},
      -- 该列是 TIMESTAMP WITHOUT TIME ZONE，必须显式写 UTC 墙钟
      NOW() AT TIME ZONE 'UTC'
    )
  `;
}
