import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaginationMetaDto } from '../../stores/dto/store-response.dto';
import type { AdjustmentDirectionValue } from './dto/adjust-member-points.dto';

export const MEMBER_STATUS_VALUES = ['active', 'inactive', 'banned'] as const;
export const MEMBER_LEVEL_VALUES = [
  'free',
  'monthly',
  'quarterly',
  'annual',
] as const;
export const MEMBER_RECHARGE_CHANNEL_VALUES = [
  'wechat',
  'alipay',
  'card',
] as const;

export type MemberStatusValue = (typeof MEMBER_STATUS_VALUES)[number];
export type MemberLevelValue = (typeof MEMBER_LEVEL_VALUES)[number];
export type MemberRechargeChannelValue =
  (typeof MEMBER_RECHARGE_CHANNEL_VALUES)[number];

export type MemberStatusDb = 'ACTIVE' | 'INACTIVE' | 'BANNED';

export function isMemberLevelValue(
  value: string | undefined,
): value is MemberLevelValue {
  return (
    value === 'free' ||
    value === 'monthly' ||
    value === 'quarterly' ||
    value === 'annual'
  );
}

export interface ResolvedPagination {
  page: number;
  skip: number;
  take: number;
}

export function toApiMemberStatus(status: MemberStatusDb): MemberStatusValue {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'INACTIVE':
      return 'inactive';
    case 'BANNED':
      return 'banned';
  }
}

export function toDbMemberStatus(
  status?: MemberStatusValue,
): MemberStatusDb | undefined {
  if (!status) {
    return undefined;
  }

  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'inactive':
      return 'INACTIVE';
    case 'banned':
      return 'BANNED';
  }
}

export function normalizePhone(phone?: string): string | undefined {
  if (phone === undefined) {
    return undefined;
  }

  const trimmedPhone = phone.trim();
  return trimmedPhone === '' ? undefined : trimmedPhone;
}

export function normalizeOptionalText(
  value?: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === '' ? null : trimmedValue;
}

export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number,
): PaginationMetaDto {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}

export function resolvePagination(
  page: number | undefined,
  pageSize: number | undefined,
  defaultPageSize: number,
  maxPageSize: number,
): ResolvedPagination {
  const safePage = page && page > 0 ? page : 1;
  const safePageSize = pageSize && pageSize > 0 ? pageSize : defaultPageSize;
  const take = Math.min(safePageSize, maxPageSize);

  return {
    page: safePage,
    skip: (safePage - 1) * take,
    take,
  };
}

export function parseMemberId(memberId?: string): number {
  if (!memberId) {
    throw new NotFoundException('缺少会员 ID');
  }

  const parsedMemberId = Number.parseInt(memberId, 10);
  if (!Number.isInteger(parsedMemberId) || parsedMemberId <= 0) {
    throw new NotFoundException('会员 ID 不合法');
  }

  return parsedMemberId;
}

export function resolveAdjustmentDelta(
  input: {
    delta?: number;
    amount?: number;
    direction?: AdjustmentDirectionValue;
  },
  assetLabel: string,
): number {
  if (typeof input.delta === 'number') {
    return input.delta;
  }

  if (typeof input.amount !== 'number') {
    throw new BadRequestException(`缺少${assetLabel}调整值`);
  }

  switch (input.direction) {
    case 'add':
      return Math.abs(input.amount);
    case 'subtract':
    case 'deduct':
    case 'reduce':
      return -Math.abs(input.amount);
    default:
      return input.amount;
  }
}
