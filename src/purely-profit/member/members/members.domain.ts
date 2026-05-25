import { MembersOverviewResponseDto } from './dto/member-overview.dto';
import type { MemberRecord } from './members.mapper';
import {
  MEMBER_LEVEL_VALUES,
  MEMBER_STATUS_VALUES,
  normalizeOptionalText,
  normalizePhone,
  toApiMemberStatus,
  toDbMemberStatus,
  isMemberLevelValue,
  type MemberLevelValue,
  type MemberStatusDb,
  type MemberStatusValue,
} from './members.utils';
import type {
  MemberLevelMetaRow,
  MemberMutationInput,
  MemberRechargeHistoryInput,
  MemberStatusMetaRow,
  PreparedMemberCreateInput,
  PreparedMemberUpdateInput,
} from './members.types';

function toNullableDate(value?: string): Date | null {
  return value ? new Date(value) : null;
}

function sumRechargeAmounts(
  rechargeHistory: MemberRechargeHistoryInput[],
): number {
  return rechargeHistory.reduce((sum, record) => sum + record.amount, 0);
}

function trimOptionalString(value?: string): string | undefined {
  return value?.trim();
}

function resolveNextBannedReason(
  previousStatus: MemberStatusDb,
  previousBannedReason: string | null,
  nextStatus: MemberStatusDb,
  requestedBannedReason: string | undefined,
): string | null {
  if (nextStatus !== 'BANNED') {
    return null;
  }

  if (requestedBannedReason !== undefined) {
    return normalizeOptionalText(requestedBannedReason) ?? null;
  }

  return previousStatus === 'BANNED' ? (previousBannedReason ?? null) : null;
}

export function prepareMemberCreateInput(
  storeId: number,
  name: string,
  input: MemberMutationInput,
): PreparedMemberCreateInput {
  const normalizedPhone = normalizePhone(input.phone);
  const level = input.level ?? 'free';
  const points = input.availablePoints ?? 0;
  const totalPointsEarnedInput = input.totalPointsEarned ?? points;
  const totalPointsEarned = Math.max(totalPointsEarnedInput, points, 0);
  const beanBalance = input.beanBalance ?? 0;
  const isPartner = input.isPartner ?? false;
  const partnerLevel = isPartner
    ? (trimOptionalString(input.partnerLevel) ?? null)
    : null;
  const rechargeHistory = input.rechargeHistory ?? [];
  const totalRecharged =
    input.totalRecharged ?? sumRechargeAmounts(rechargeHistory);
  const rechargeCount = input.rechargeCount ?? rechargeHistory.length;
  const invitedCount = input.invitedCount ?? 0;
  const status = toDbMemberStatus(input.status) ?? 'ACTIVE';
  const note =
    status === 'BANNED' && input.bannedReason === undefined
      ? null
      : (normalizeOptionalText(input.remark) ?? null);
  const normalizedBanReason = normalizeOptionalText(
    input.bannedReason ?? input.remark,
  );

  return {
    storeId,
    name: name.trim(),
    phone: normalizedPhone ?? null,
    gender: input.gender ?? 'UNKNOWN',
    level,
    note,
    birthday: toNullableDate(input.birthday),
    lastConsumeAt: toNullableDate(input.lastActiveAt),
    points,
    totalPointsEarned,
    beanBalance,
    isPartner,
    partnerLevel,
    totalRecharged,
    rechargeCount,
    invitedCount,
    bannedReason: status === 'BANNED' ? (normalizedBanReason ?? null) : null,
    status,
    rechargeHistory,
  };
}

export function prepareMemberUpdateInput(
  existingMember: MemberRecord,
  input: MemberMutationInput,
): PreparedMemberUpdateInput {
  const normalizedPhone = normalizePhone(input.phone);
  const nextStatus = input.status
    ? (toDbMemberStatus(input.status) ?? existingMember.status)
    : existingMember.status;
  const rechargeHistory = input.rechargeHistory;
  const nextPoints = input.availablePoints ?? existingMember.points;
  const requestedTotalPointsEarned =
    input.totalPointsEarned ?? existingMember.totalPointsEarned;
  const nextTotalPointsEarned = Math.max(
    requestedTotalPointsEarned,
    nextPoints,
    0,
  );
  const nextTotalRecharged =
    input.totalRecharged ??
    (rechargeHistory
      ? sumRechargeAmounts(rechargeHistory)
      : existingMember.totalRecharged);
  const nextRechargeCount =
    input.rechargeCount ??
    (rechargeHistory ? rechargeHistory.length : existingMember.rechargeCount);
  const nextBannedReason = resolveNextBannedReason(
    existingMember.status,
    existingMember.bannedReason,
    nextStatus,
    input.bannedReason ?? (nextStatus === 'BANNED' ? input.remark : undefined),
  );
  const assignments: PreparedMemberUpdateInput['assignments'] = [];

  if (input.name !== undefined) {
    assignments.push({ field: 'name', value: input.name.trim() });
  }
  if (input.phone !== undefined) {
    assignments.push({ field: 'phone', value: normalizedPhone ?? null });
  }
  if (input.gender !== undefined) {
    assignments.push({ field: 'gender', value: input.gender });
  }
  if (input.level !== undefined) {
    assignments.push({ field: 'level', value: input.level ?? 'free' });
  }
  if (
    input.remark !== undefined &&
    !(nextStatus === 'BANNED' && input.bannedReason === undefined)
  ) {
    assignments.push({
      field: 'note',
      value: normalizeOptionalText(input.remark) ?? null,
    });
  }
  if (input.birthday !== undefined) {
    assignments.push({
      field: 'birthday',
      value: toNullableDate(input.birthday),
    });
  }
  if (input.lastActiveAt !== undefined) {
    assignments.push({
      field: 'lastConsumeAt',
      value: toNullableDate(input.lastActiveAt),
    });
  }
  if (
    input.availablePoints !== undefined ||
    input.totalPointsEarned !== undefined
  ) {
    assignments.push({ field: 'points', value: nextPoints });
    assignments.push({
      field: 'totalPointsEarned',
      value: nextTotalPointsEarned,
    });
  }
  if (input.beanBalance !== undefined) {
    assignments.push({ field: 'beanBalance', value: input.beanBalance });
  }
  if (input.isPartner !== undefined) {
    assignments.push({ field: 'isPartner', value: input.isPartner });
    if (!input.isPartner) {
      assignments.push({ field: 'partnerLevel', value: null });
    }
  }
  if (input.partnerLevel !== undefined) {
    assignments.push({
      field: 'partnerLevel',
      value: trimOptionalString(input.partnerLevel) ?? null,
    });
  }
  if (input.totalRecharged !== undefined || rechargeHistory !== undefined) {
    assignments.push({ field: 'totalRecharged', value: nextTotalRecharged });
  }
  if (input.rechargeCount !== undefined || rechargeHistory !== undefined) {
    assignments.push({ field: 'rechargeCount', value: nextRechargeCount });
  }
  if (input.invitedCount !== undefined) {
    assignments.push({ field: 'invitedCount', value: input.invitedCount });
  }
  if (input.status !== undefined) {
    assignments.push({ field: 'status', value: nextStatus });
  }
  if (input.status !== undefined || input.bannedReason !== undefined) {
    assignments.push({
      field: 'bannedReason',
      value: nextBannedReason ?? null,
    });
  }

  return {
    normalizedPhone,
    rechargeHistory,
    assignments,
  };
}

export function buildMemberLevelMetaRows(
  rows: MemberLevelMetaRow[],
): Array<{ value: MemberLevelValue; count: number }> {
  const countMap = new Map<MemberLevelValue, number>(
    MEMBER_LEVEL_VALUES.map((value) => [value, 0]),
  );

  for (const row of rows) {
    if (isMemberLevelValue(row.value)) {
      countMap.set(row.value, row.count);
    }
  }

  return Array.from(countMap.entries()).map(([value, count]) => ({
    value,
    count,
  }));
}

export function buildEmptyMembersOverviewResponse(): MembersOverviewResponseDto {
  return {
    totalCount: 0,
    activeCount: 0,
    partnerCount: 0,
    bannedCount: 0,
  };
}

export function buildMemberStatusMetaRows(
  rows: MemberStatusMetaRow[],
): Array<{ value: MemberStatusValue; count: number }> {
  const countMap = new Map<MemberStatusValue, number>(
    MEMBER_STATUS_VALUES.map((value) => [value, 0]),
  );

  for (const row of rows) {
    countMap.set(toApiMemberStatus(row.value), row.count);
  }

  return Array.from(countMap.entries()).map(([value, count]) => ({
    value,
    count,
  }));
}
