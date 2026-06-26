import { Prisma } from '@prisma/client';
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

export async function insertMemberRecord(
  client: Prisma.TransactionClient,
  input: PreparedMemberCreateInput,
): Promise<MemberRecord> {
  const idRows = await client.$queryRaw<Array<{ id: number }>>`
    INSERT INTO members (
      store_id,
      name,
      phone,
      gender,
      note,
      birthday,
      bean_balance,
      is_partner,
      partner_level,
      banned_reason,
      status
    )
    VALUES (
      ${input.storeId},
      ${input.name},
      ${input.phone},
      ${input.gender}::"MemberGender",
      ${input.note},
      ${input.birthday},
      ${input.beanBalance},
      ${input.isPartner},
      ${input.partnerLevel},
      ${input.bannedReason},
      ${input.status}::"MemberStatus"
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
        updated_at = NOW()
    WHERE id = ${memberId}
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
    SET deleted_at = NOW()
    WHERE id = ${memberId}
      AND deleted_at IS NULL
  `;
}

export async function replaceMemberRechargeHistory(
  client: Prisma.TransactionClient,
  params: {
    memberId: number;
    storeId: number;
    operatorStaffId: number | null;
    rechargeHistory: PreparedMemberCreateInput['rechargeHistory'];
  },
): Promise<void> {
  await client.$executeRaw`
    DELETE FROM member_recharge_logs
    WHERE member_id = ${params.memberId}
  `;

  for (const record of params.rechargeHistory) {
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
      VALUES (
        ${params.memberId},
        ${params.storeId},
        ${params.operatorStaffId},
        ${record.planName},
        ${record.amount},
        ${record.pointsAwarded},
        ${record.channel}::"MemberRechargeChannel",
        ${new Date(record.createdAt)}
      )
    `;
  }
}
