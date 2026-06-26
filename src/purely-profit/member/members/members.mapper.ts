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

/** 营销顾客运行态字段（从 marketing_customers 表 LEFT JOIN 取得） */
export interface MemberCustomerRecord {
  id: number;
  tier: string;
  points: number;
  totalSpent: number;
  visitCount: number;
  lastVisitAt: Date | null;
  balance: number;
}

export interface MemberRecord {
  id: number;
  storeId: number;
  customerId: number | null;
  /** 通过 LEFT JOIN marketing_customers 获取，可为 null（若未关联顾客档案） */
  customer: MemberCustomerRecord | null;
  name: string;
  phone: string | null;
  gender: MemberGender;
  note: string | null;
  birthday: Date | null;
  /** 纯利豆余额（独立于营销积分，保留在 Member） */
  beanBalance: number;
  isPartner: boolean;
  partnerLevel: string | null;
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

/**
 * 将 MarketingCustomer.tier 映射到前端 MemberLevel 字面量
 * tier: regular / gold / diamond
 * MemberLevel: free / monthly / quarterly / annual
 *
 * 映射规则：gold→quarterly, diamond→annual, regular→free
 * （tier 是后端业务等级，level 是前端 UI 展示等级，两套不同语义）
 */
function tierToMemberLevel(tier: string | null | undefined): MemberLevelValue {
  switch (tier) {
    case 'diamond':
      return 'annual';
    case 'gold':
      return 'quarterly';
    default:
      return 'free';
  }
}

export function toMemberResponse(
  member: MemberRecord,
  rechargeRecords: MemberRechargeRecord[] = [],
): MemberResponseDto {
  const customer = member.customer;

  // 最近活跃时间：优先读 MarketingCustomer.lastVisitAt，否则回退到 member.updatedAt
  const lastActiveAt =
    customer?.lastVisitAt ?? member.updatedAt ?? member.createdAt;

  const remark =
    member.status === 'banned' && member.bannedReason
      ? member.bannedReason
      : member.note;

  return {
    id: String(member.id),
    name: member.name,
    phone: member.phone ?? '',
    avatarChar: toAvatarChar(member.name),
    avatarColorIdx: toAvatarColorIdx(member.id),
    status: toApiMemberStatus(member.status),
    // 等级：从 MarketingCustomer.tier 推导
    level: tierToMemberLevel(customer?.tier),
    registeredAt: toTimestampMs(member.createdAt),
    lastActiveAt: toTimestampMs(lastActiveAt),
    // 积分：从 MarketingCustomer.points 读取
    availablePoints: customer?.points ?? 0,
    // spec: totalPointsEarned 不再维护，返回 0（不读已删除字段）
    totalPointsEarned: customer?.points ?? 0,
    // 纯利豆：独立于营销积分，仍保留在 Member
    beanBalance: member.beanBalance,
    isPartner: member.isPartner,
    ...(member.partnerLevel ? { partnerLevel: member.partnerLevel } : {}),
    // spec: totalRecharged / rechargeCount 不再维护，返回 0
    totalRecharged: 0,
    rechargeCount: 0,
    // spec: invitedCount 不再维护，返回 0
    invitedCount: 0,
    rechargeHistory: toRechargeHistory(rechargeRecords),
    ...(remark ? { remark } : {}),
    ...(member.bannedReason ? { bannedReason: member.bannedReason } : {}),
  };
}
