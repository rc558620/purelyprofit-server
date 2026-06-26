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
  MemberStatusMetaRow,
  PreparedMemberCreateInput,
  PreparedMemberUpdateInput,
} from './members.types';

function toNullableDate(value?: string): Date | null {
  return value ? new Date(value) : null;
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
  if (nextStatus !== 'banned') {
    return null;
  }

  if (requestedBannedReason !== undefined) {
    return normalizeOptionalText(requestedBannedReason) ?? null;
  }

  return previousStatus === 'banned' ? (previousBannedReason ?? null) : null;
}

export function prepareMemberCreateInput(
  storeId: number,
  name: string,
  input: MemberMutationInput,
): PreparedMemberCreateInput {
  const normalizedPhone = normalizePhone(input.phone);
  const beanBalance = input.beanBalance ?? 0;
  const isPartner = input.isPartner ?? false;
  const partnerLevel = isPartner
    ? (trimOptionalString(input.partnerLevel) ?? null)
    : null;
  const rechargeHistory = input.rechargeHistory ?? [];
  const status = toDbMemberStatus(input.status) ?? 'active';
  const note =
    status === 'banned' && input.bannedReason === undefined
      ? null
      : (normalizeOptionalText(input.remark) ?? null);
  const normalizedBanReason = normalizeOptionalText(
    input.bannedReason ?? input.remark,
  );

  return {
    storeId,
    name: name.trim(),
    phone: normalizedPhone ?? null,
    gender: input.gender ?? 'unknown',
    note,
    birthday: toNullableDate(input.birthday),
    beanBalance,
    isPartner,
    partnerLevel,
    bannedReason: status === 'banned' ? (normalizedBanReason ?? null) : null,
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
  const nextBannedReason = resolveNextBannedReason(
    existingMember.status,
    existingMember.bannedReason,
    nextStatus,
    input.bannedReason ?? (nextStatus === 'banned' ? input.remark : undefined),
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
  if (
    input.remark !== undefined &&
    !(nextStatus === 'banned' && input.bannedReason === undefined)
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
