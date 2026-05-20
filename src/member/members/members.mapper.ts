import { MemberGender } from '@prisma/client';
import {
  MemberRechargeRecordDto,
  MemberResponseDto,
} from './dto/member-response.dto';
import {
  type MemberLevelValue,
  type MemberRechargeChannelValue,
  type MemberStatusDb,
  toApiMemberStatus,
} from './members.utils';

const AVATAR_COLOR_COUNT = 6;

export interface MemberRecord {
  id: number;
  storeId: number;
  name: string;
  phone: string | null;
  gender: MemberGender;
  level: string;
  note: string | null;
  birthday: Date | null;
  lastConsumeAt: Date | null;
  points: number;
  totalPointsEarned: number;
  beanBalance: number;
  isPartner: boolean;
  partnerLevel: string | null;
  totalRecharged: number;
  rechargeCount: number;
  invitedCount: number;
  bannedReason: string | null;
  status: MemberStatusDb;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberRechargeRecord {
  id: number;
  planName: string;
  amount: number;
  pointsAwarded: number;
  channel: MemberRechargeChannelValue;
  createdAt: Date;
}

function toTimestampMs(value: Date): number {
  return value.getTime();
}

function toAvatarChar(name: string): string {
  const trimmedName = name.trim();
  return trimmedName.length > 0 ? trimmedName[0] : '?';
}

function toAvatarColorIdx(memberId: number): number {
  return Math.abs(memberId) % AVATAR_COLOR_COUNT;
}

function toRechargeHistory(
  records: MemberRechargeRecord[],
): MemberRechargeRecordDto[] {
  return records.map((record) => ({
    id: `rc-${record.id}`,
    planName: record.planName,
    amount: record.amount,
    pointsAwarded: record.pointsAwarded,
    channel: record.channel,
    createdAt: toTimestampMs(record.createdAt),
  }));
}

function toMemberLevel(level: string): MemberLevelValue {
  switch (level) {
    case 'free':
    case 'monthly':
    case 'quarterly':
    case 'annual':
      return level;
    default:
      return 'free';
  }
}

export function toMemberResponse(
  member: MemberRecord,
  rechargeRecords: MemberRechargeRecord[] = [],
): MemberResponseDto {
  const lastActiveAt =
    member.lastConsumeAt ?? member.updatedAt ?? member.createdAt;
  const remark =
    member.status === 'BANNED' && member.bannedReason
      ? member.bannedReason
      : member.note;

  return {
    id: String(member.id),
    name: member.name,
    phone: member.phone ?? '',
    avatarChar: toAvatarChar(member.name),
    avatarColorIdx: toAvatarColorIdx(member.id),
    status: toApiMemberStatus(member.status),
    level: toMemberLevel(member.level),
    registeredAt: toTimestampMs(member.createdAt),
    lastActiveAt: toTimestampMs(lastActiveAt),
    availablePoints: member.points,
    totalPointsEarned: Math.max(member.totalPointsEarned, member.points),
    beanBalance: member.beanBalance,
    isPartner: member.isPartner,
    ...(member.partnerLevel ? { partnerLevel: member.partnerLevel } : {}),
    totalRecharged: member.totalRecharged,
    rechargeCount: member.rechargeCount,
    invitedCount: member.invitedCount,
    rechargeHistory: toRechargeHistory(rechargeRecords),
    ...(remark ? { remark } : {}),
    ...(member.bannedReason ? { bannedReason: member.bannedReason } : {}),
  };
}
