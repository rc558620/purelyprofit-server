import { Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { type MemberRecord } from './members.mapper';
import {
  MEMBER_SELECT_BY_ID_SQL,
  requireMemberRow,
} from './members-query.shared';
import type {
  PreparedMemberCreateInput,
  PreparedMemberUpdateInput,
} from './members.types';

function buildMemberUpdateClauses(
  assignments: PreparedMemberUpdateInput['assignments'],
): Prisma.Sql[] {
  return assignments.map((assignment) => {
    switch (assignment.field) {
      case 'name':
        return Prisma.sql`name = ${assignment.value}`;
      case 'phone':
        return Prisma.sql`phone = ${assignment.value}`;
      case 'gender':
        return Prisma.sql`gender = ${assignment.value}::"MemberGender"`;
      case 'note':
        return Prisma.sql`note = ${assignment.value}`;
      case 'birthday':
        return Prisma.sql`birthday = ${assignment.value}`;
      case 'beanBalance':
        return Prisma.sql`bean_balance = ${assignment.value}`;
      case 'isPartner':
        return Prisma.sql`is_partner = ${assignment.value}`;
      case 'partnerLevel':
        return Prisma.sql`partner_level = ${assignment.value}`;
      case 'status':
        return Prisma.sql`status = ${assignment.value}::"MemberStatus"`;
      case 'bannedReason':
        return Prisma.sql`banned_reason = ${assignment.value}`;
    }
  });
}

/**
 * 为新建会员解析（或创建）营销顾客档案 ID。
 *
 * 会员的积分 / 等级 / 最近活跃时间事实源在 marketing_customers，
 * 若新建会员不关联顾客档案，积分调整接口会直接不可用、等级与积分恒为初始值。
 *
 * - 手机号为空时无法按号匹配，返回 null（不建档）；
 * - 同店同号已存在且未被其它会员占用（member_id IS NULL）→ 复用；
 * - 已存在但已被其它会员占用 → 不复用（member_id 有唯一约束），返回 null；
 * - 不存在 → 新建 regular 档顾客。
 */
export async function resolveOrCreateCustomerForMember(
  client: Prisma.TransactionClient,
  params: { storeId: number; name: string; phone: string | null },
): Promise<number | null> {
  if (!params.phone) {
    return null;
  }

  const existingRows = await client.$queryRaw<
    Array<{ id: number; memberId: number | null }>
  >`
    SELECT id, member_id AS "memberId"
    FROM marketing_customers
    WHERE store_id = ${params.storeId}
      AND phone = ${params.phone}
      AND deleted_at IS NULL
    ORDER BY id ASC
    LIMIT 1
  `;

  const existing = existingRows[0];
  if (existing) {
    return existing.memberId === null ? existing.id : null;
  }

  const createdRows = await client.$queryRaw<Array<{ id: number }>>`
    INSERT INTO marketing_customers (
      store_id,
      name,
      phone,
      tier,
      status,
      created_at,
      updated_at
    )
    VALUES (
      ${params.storeId},
      ${params.name},
      ${params.phone},
      'regular'::"MarketingCustomerTier",
      'active'::"MarketingCustomerStatus",
      -- 时间列是 TIMESTAMP WITHOUT TIME ZONE，必须显式写 UTC 墙钟
      NOW() AT TIME ZONE 'UTC',
      NOW() AT TIME ZONE 'UTC'
    )
    RETURNING id
  `;

  return createdRows[0]?.id ?? null;
}

/** 双向绑定：把顾客档案反向指回会员（marketing_customers.member_id） */
export async function linkCustomerToMember(
  client: Prisma.TransactionClient,
  customerId: number,
  memberId: number,
): Promise<void> {
  await client.$executeRaw`
    UPDATE marketing_customers
    SET member_id = ${memberId}, updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE id = ${customerId}
      AND member_id IS NULL
  `;
}

export async function insertMemberRecord(
  client: Prisma.TransactionClient,
  input: PreparedMemberCreateInput,
  customerId: number | null,
): Promise<MemberRecord> {
  const idRows = await client.$queryRaw<Array<{ id: number }>>`
    INSERT INTO members (
      store_id,
      customer_id,
      name,
      phone,
      gender,
      note,
      birthday,
      bean_balance,
      is_partner,
      partner_level,
      banned_reason,
      status,
      created_at,
      updated_at
    )
    VALUES (
      ${input.storeId},
      ${customerId},
      ${input.name},
      ${input.phone},
      ${input.gender}::"MemberGender",
      ${input.note},
      ${input.birthday},
      ${input.beanBalance},
      ${input.isPartner},
      ${input.partnerLevel},
      ${input.bannedReason},
      ${input.status}::"MemberStatus",
      -- 时间列是 TIMESTAMP WITHOUT TIME ZONE，必须显式写 UTC 墙钟，
      -- 否则走 CURRENT_TIMESTAMP 会取数据库会话时区墙钟，被驱动按 UTC 读成 +8h
      NOW() AT TIME ZONE 'UTC',
      NOW() AT TIME ZONE 'UTC'
    )
    RETURNING id
  `;

  const id = idRows[0]?.id;
  if (!id) throw new Error('会员插入失败，未获得 ID');

  // 重查完整记录（含 LEFT JOIN marketing_customers）
  const rows = await client.$queryRaw<MemberRecord[]>(
    MEMBER_SELECT_BY_ID_SQL(id),
  );
  return requireMemberRow(rows[0]);
}

export async function updateMemberRecord(
  client: Prisma.TransactionClient,
  memberId: number,
  assignments: PreparedMemberUpdateInput['assignments'],
): Promise<MemberRecord> {
  const updates = buildMemberUpdateClauses(assignments);
  await client.$executeRaw`
    UPDATE members
    SET ${Prisma.join(updates, ', ')},
        updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE id = ${memberId}
      AND deleted_at IS NULL
  `;

  // 重查完整记录（含 LEFT JOIN marketing_customers）
  const rows = await client.$queryRaw<MemberRecord[]>(
    MEMBER_SELECT_BY_ID_SQL(memberId),
  );
  return requireMemberRow(rows[0]);
}

export async function deleteMemberRecord(
  client: Prisma.TransactionClient,
  memberId: number,
): Promise<void> {
  // 软删除：更新 deleted_at 字段而非物理删除
  await client.$executeRaw`
    UPDATE members
    SET deleted_at = NOW() AT TIME ZONE 'UTC'
    WHERE id = ${memberId}
      AND deleted_at IS NULL
  `;
}

type RechargeHistoryItem = PreparedMemberCreateInput['rechargeHistory'][number];

/** 客户端充值记录 id 形如 `rc-{dbId}`；解析不出则视为新记录 */
function parseRechargeRecordId(id: string | undefined): number | null {
  if (!id) {
    return null;
  }

  const matched = /^rc-(\d+)$/.exec(id);
  if (!matched) {
    return null;
  }

  const parsed = Number.parseInt(matched[1], 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** 非法时间戳回退为 null（写库时再回退到 NOW()），避免 Invalid Date 落库 */
function toRechargeCreatedAt(createdAt: number): string | null {
  if (!Number.isFinite(createdAt)) {
    return null;
  }

  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * 全量替换会员充值记录（保持「请求体即最新全量」的语义）。
 *
 * 这里刻意不再用「先 DELETE 全部、再 INSERT 全部」的写法，原因：
 *   ① operator_staff_id 会被重置成当前操作人，等于改一次会员资料就篡改一遍
 *      历史流水的归属，审计上不可接受；
 *   ② 客户端回传的 `rc-{id}` 被丢弃，每次都是全新插入，记录 id 不断漂移；
 *   ③ 逐条 INSERT，N 条记录 N 次往返。
 *
 * 改为按 id 分类处理：命中本会员现存记录 → UPDATE（保留原 operator_staff_id），
 * 未命中 / 无 id / id 不属于本会员 → INSERT，请求中缺失的 → 按 id 精确 DELETE。
 */
export async function replaceMemberRechargeHistory(
  client: Prisma.TransactionClient,
  params: {
    memberId: number;
    storeId: number;
    operatorStaffId: number | null;
    rechargeHistory: PreparedMemberCreateInput['rechargeHistory'];
  },
): Promise<void> {
  const existingRows = await client.$queryRaw<
    Array<{ id: number; operatorStaffId: number | null }>
  >`
    SELECT id, operator_staff_id AS "operatorStaffId"
    FROM member_recharge_logs
    WHERE member_id = ${params.memberId}
  `;
  const existingById = new Map(
    existingRows.map((row) => [row.id, row] as const),
  );

  const toUpdate = new Map<number, RechargeHistoryItem>();
  const toInsert: RechargeHistoryItem[] = [];

  for (const record of params.rechargeHistory) {
    const recordId = parseRechargeRecordId(record.id);
    // 只有「解析出 id 且该 id 确实属于本会员」才走更新；
    // 伪造或已删除的 id 一律当新记录，绝不跨会员改别人的流水。
    if (recordId !== null && existingById.has(recordId)) {
      toUpdate.set(recordId, record);
    } else {
      toInsert.push(record);
    }
  }

  // 请求里没带回来、但库里还存在的，按 id 精确删除（不再无条件 DELETE 全表）
  const staleIds = existingRows
    .map((row) => row.id)
    .filter((id) => !toUpdate.has(id));

  if (staleIds.length > 0) {
    await client.$executeRaw`
      DELETE FROM member_recharge_logs
      WHERE member_id = ${params.memberId}
        AND id IN (${Prisma.join(staleIds)})
    `;
  }

  for (const [recordId, record] of toUpdate) {
    const createdAt = toRechargeCreatedAt(record.createdAt);
    await client.$executeRaw`
      UPDATE member_recharge_logs
      SET plan_name = ${record.planName},
          -- DTO 侧单位为「元」，DB 存「分」：入站统一经 Money.fromInputYuan 换算，
          -- 与出站 Money.fromDbCents(...).toOutputYuan() 形成闭环
          amount = ${Money.fromInputYuan(record.amount).toDbCents()},
          points_awarded = ${record.pointsAwarded},
          channel = ${record.channel}::"MemberRechargeChannel",
          created_at = COALESCE(${createdAt}::timestamp, created_at)
      WHERE id = ${recordId}
        AND member_id = ${params.memberId}
    `;
  }

  if (toInsert.length > 0) {
    const values = toInsert.map((record) => {
      const createdAt = toRechargeCreatedAt(record.createdAt);
      return Prisma.sql`(
        ${params.memberId},
        ${params.storeId},
        ${params.operatorStaffId},
        ${record.planName},
        ${Money.fromInputYuan(record.amount).toDbCents()},
        ${record.pointsAwarded},
        ${record.channel}::"MemberRechargeChannel",
        -- 时间列是 TIMESTAMP WITHOUT TIME ZONE，必须显式写 UTC 墙钟
        COALESCE(${createdAt}::timestamp, NOW() AT TIME ZONE 'UTC')
      )`;
    });

    await client.$executeRaw`
      INSERT INTO member_recharge_logs (
        member_id,
        store_id,
        operator_staff_id,
        plan_name,
        amount,
        points_awarded,
        channel,
        created_at
      )
      VALUES ${Prisma.join(values)}
    `;
  }
}
