import type { Prisma, MemberGender } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  AdjustmentDirectionValue,
  MemberBeanRecordSourceValue,
  MemberBeanRecordTypeValue,
  MemberPointsRecordSourceValue,
  MemberPointsRecordTypeValue,
} from './dto/adjust-member-points.dto';
import type { MemberRecord } from './members.mapper';
import type {
  MemberLevelValue,
  MemberRechargeChannelValue,
  MemberStatusValue,
} from './members.utils';
import type { MemberStatusDb } from './members.utils';

export interface CountRow {
  count: number;
}

export interface MemberAssetAdjustmentInput {
  userId?: string;
  memberId?: string;
  id?: string;
  delta?: number;
  amount?: number;
  direction?: AdjustmentDirectionValue;
  reason: string;
}

export interface ResolvedMemberAssetAdjustment {
  member: MemberRecord;
  operatorStaffId: number | null;
  delta: number;
  reason: string;
  beforeValue: number;
  afterValue: number;
}

export interface MemberAssetOverviewParams<TOverview> {
  storeId: number | null;
  emptyOverview: TOverview;
  query: (prisma: PrismaService, storeId: number) => Promise<TOverview | null>;
}

export interface QueryMemberAssetLogsInput<TType, TSource> {
  storeId: number;
  memberId?: number;
  skip: number;
  take: number;
  type?: TType;
  source?: TSource;
  keyword?: string;
}

export interface MemberAssetLogQueryParams<TType, TSource, TRow, TItem> {
  storeId: number | null;
  memberId?: number;
  page?: number;
  pageSize?: number;
  type?: TType;
  source?: TSource;
  keyword?: string;
  query: (
    prisma: PrismaService,
    params: QueryMemberAssetLogsInput<TType, TSource>,
  ) => Promise<{ items: TRow[]; total: number }>;
  mapItem: (item: TRow) => TItem;
}

export interface AdjustMemberAssetParams<TLog, TRecord, TApplyInput> {
  user: AuthenticatedUser;
  input: MemberAssetAdjustmentInput;
  memberId?: number;
  assetLabel: string;
  insufficientMessage: string;
  getCurrentValue: (member: MemberRecord) => number;
  buildApplyInput: (adjustment: ResolvedMemberAssetAdjustment) => TApplyInput;
  apply: (
    transaction: Prisma.TransactionClient,
    input: TApplyInput,
  ) => Promise<{ member: MemberRecord; log: TLog }>;
  mapRecord: (log: TLog) => TRecord;
}

export interface ApplyMemberPointsAdjustmentInput {
  member: MemberRecord;
  operatorStaffId: number | null;
  beforePoints: number;
  afterPoints: number;
  delta: number;
  reason: string;
}

export interface ApplyMemberBeansAdjustmentInput {
  member: MemberRecord;
  operatorStaffId: number | null;
  beforeBalance: number;
  afterBalance: number;
  delta: number;
  reason: string;
}

export interface MemberAssetOverviewQueryConfig {
  selectSql: Prisma.Sql;
  fromSql: Prisma.Sql;
}

export interface MemberAssetLogsWhereClauseConfig<TType, TSource> {
  buildTypeFilters: (type: TType | undefined) => Prisma.Sql[];
  buildSourceFilter: (source: TSource) => Prisma.Sql;
  buildKeywordFilter: (keyword: string) => Prisma.Sql;
}

export interface MemberAssetLogsQueryConfig<TType, TSource> {
  fromSql: Prisma.Sql;
  selectSql: Prisma.Sql;
  buildWhereClause: (
    params: QueryMemberAssetLogsInput<TType, TSource>,
  ) => Prisma.Sql;
}

export interface MemberPointsOverviewRow {
  totalCount: number;
  adminAdjustCount: number;
  todayChangeCount: number;
}

export interface MemberBeansOverviewRow {
  totalCount: number;
  adminAdjustCount: number;
  promoRewardCount: number;
  withdrawCount: number;
}

export type QueryMemberPointsLogsInput = QueryMemberAssetLogsInput<
  MemberPointsRecordTypeValue,
  MemberPointsRecordSourceValue
>;

export type QueryMemberBeanLogsInput = QueryMemberAssetLogsInput<
  MemberBeanRecordTypeValue,
  MemberBeanRecordSourceValue
>;

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
