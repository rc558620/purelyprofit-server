import { MemberGender } from '@prisma/client';
import type {
  MemberLevelValue,
  MemberRechargeChannelValue,
  MemberStatusValue,
} from './members.utils';
import type { MemberStatusDb } from './members.utils';

export interface CountRow {
  count: number;
}

export interface MemberLevelMetaRow {
  value: string;
  count: number;
}

export interface MemberOverviewRow {
  totalCount: number;
  activeCount: number;
  partnerCount: number;
  bannedCount: number;
}

export interface MemberStatusMetaRow {
  value: MemberStatusDb;
  count: number;
}

export interface MemberSnapshotRow {
  id: number;
  name: string;
  phone: string | null;
  points: number;
  beanBalance: number;
  isPartner: boolean;
}

export interface MemberSnapshotsQueryInput {
  storeId?: number;
  keyword?: string;
  onlyPartners?: boolean;
}

export interface MemberRechargeHistoryInput {
  id?: string;
  planName: string;
  amount: number;
  pointsAwarded: number;
  channel: MemberRechargeChannelValue;
  createdAt: number;
}

export interface MemberMutationInput {
  name?: string;
  phone?: string;
  gender?: MemberGender;
  level?: MemberLevelValue;
  status?: MemberStatusValue;
  remark?: string;
  birthday?: string;
  lastActiveAt?: string;
  availablePoints?: number;
  totalPointsEarned?: number;
  beanBalance?: number;
  isPartner?: boolean;
  partnerLevel?: string;
  totalRecharged?: number;
  rechargeCount?: number;
  invitedCount?: number;
  rechargeHistory?: MemberRechargeHistoryInput[];
  bannedReason?: string;
}

export interface PreparedMemberCreateInput {
  storeId: number;
  name: string;
  phone: string | null;
  gender: MemberGender;
  level: MemberLevelValue;
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
  rechargeHistory: MemberRechargeHistoryInput[];
}

export type MemberUpdateAssignment =
  | { field: 'name'; value: string }
  | { field: 'phone'; value: string | null }
  | { field: 'gender'; value: MemberGender }
  | { field: 'level'; value: MemberLevelValue }
  | { field: 'note'; value: string | null }
  | { field: 'birthday'; value: Date | null }
  | { field: 'lastConsumeAt'; value: Date | null }
  | { field: 'points'; value: number }
  | { field: 'totalPointsEarned'; value: number }
  | { field: 'beanBalance'; value: number }
  | { field: 'isPartner'; value: boolean }
  | { field: 'partnerLevel'; value: string | null }
  | { field: 'totalRecharged'; value: number }
  | { field: 'rechargeCount'; value: number }
  | { field: 'invitedCount'; value: number }
  | { field: 'status'; value: MemberStatusDb }
  | { field: 'bannedReason'; value: string | null };

export interface PreparedMemberUpdateInput {
  normalizedPhone?: string;
  rechargeHistory?: MemberRechargeHistoryInput[];
  assignments: MemberUpdateAssignment[];
}
