import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { type MemberRecord } from './members.mapper';
import { MEMBER_RETURNING_SQL, requireMemberRow } from './members-query.shared';
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
      case 'level':
        return Prisma.sql`level = ${assignment.value}`;
      case 'note':
        return Prisma.sql`note = ${assignment.value}`;
      case 'birthday':
        return Prisma.sql`birthday = ${assignment.value}`;
      case 'lastConsumeAt':
        return Prisma.sql`last_consume_at = ${assignment.value}`;
      case 'points':
        return Prisma.sql`points = ${assignment.value}`;
      case 'totalPointsEarned':
        return Prisma.sql`total_points_earned = ${assignment.value}`;
      case 'beanBalance':
        return Prisma.sql`bean_balance = ${assignment.value}`;
      case 'isPartner':
        return Prisma.sql`is_partner = ${assignment.value}`;
      case 'partnerLevel':
        return Prisma.sql`partner_level = ${assignment.value}`;
      case 'totalRecharged':
        return Prisma.sql`total_recharged = ${assignment.value}`;
      case 'rechargeCount':
        return Prisma.sql`recharge_count = ${assignment.value}`;
      case 'invitedCount':
        return Prisma.sql`invited_count = ${assignment.value}`;
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
  const rows = await client.$queryRaw<MemberRecord[]>`
    INSERT INTO members (
      store_id,
      name,
      phone,
      gender,
      level,
      note,
      birthday,
      last_consume_at,
      points,
      total_points_earned,
      bean_balance,
      is_partner,
      partner_level,
      total_recharged,
      recharge_count,
      invited_count,
      banned_reason,
      status
    )
    VALUES (
      ${input.storeId},
      ${input.name},
      ${input.phone},
      ${input.gender},
      ${input.level},
      ${input.note},
      ${input.birthday},
      ${input.lastConsumeAt},
      ${input.points},
      ${input.totalPointsEarned},
      ${input.beanBalance},
      ${input.isPartner},
      ${input.partnerLevel},
      ${input.totalRecharged},
      ${input.rechargeCount},
      ${input.invitedCount},
      ${input.bannedReason},
      ${input.status}::"MemberStatus"
    )
    ${MEMBER_RETURNING_SQL}
  `;

  return requireMemberRow(rows[0]);
}

export async function updateMemberRecord(
  client: Prisma.TransactionClient,
  memberId: number,
  assignments: PreparedMemberUpdateInput['assignments'],
): Promise<MemberRecord> {
  const updates = buildMemberUpdateClauses(assignments);
  const rows = await client.$queryRaw<MemberRecord[]>`
    UPDATE members
    SET ${Prisma.join(updates, ', ')},
        updated_at = NOW()
    WHERE id = ${memberId}
    ${MEMBER_RETURNING_SQL}
  `;

  return requireMemberRow(rows[0]);
}

export async function deleteMemberRecord(
  prisma: PrismaService,
  memberId: number,
): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM members
    WHERE id = ${memberId}
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
