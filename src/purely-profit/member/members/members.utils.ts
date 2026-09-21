import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaginationMetaDto } from '../../stores/dto/store-response.dto';
import type { AdjustmentDirectionValue } from './dto/member-asset-shared.dto';

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

export type MemberStatusDb = 'active' | 'inactive' | 'banned';

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

/**
 * 运行时收窄：toApiMemberStatus 对枚举外的值会返回 undefined
 * （TS 层面看不出来），聚合前必须先守卫，否则会把 undefined 写进统计 map。
 */
export function isMemberStatusValue(
  value: string | undefined,
): value is MemberStatusValue {
  return value === 'active' || value === 'inactive' || value === 'banned';
}

export interface ResolvedPagination {
  page: number;
  skip: number;
  take: number;
}

export function toApiMemberStatus(status: MemberStatusDb): MemberStatusValue {
  switch (status) {
    case 'active':
      return 'active';
    case 'inactive':
      return 'inactive';
    case 'banned':
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
      return 'active';
    case 'inactive':
      return 'inactive';
    case 'banned':
      return 'banned';
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

/**
 * 收口校验调整值：DTO 的 @IsInt / @NotEquals(0) 是外层防线，
 * 这里是内层兜底——NaN / Infinity / 小数 / 0 一律拦掉，
 * 避免这些值绕过校验直接落进「原子相对更新」的 SQL 里。
 */
function assertAdjustmentValue(value: number, assetLabel: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new BadRequestException(`${assetLabel}调整值必须是整数`);
  }

  if (value === 0) {
    throw new BadRequestException(`${assetLabel}调整值不能为 0`);
  }

  return value;
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
    return assertAdjustmentValue(input.delta, assetLabel);
  }

  if (typeof input.amount !== 'number') {
    throw new BadRequestException(`缺少${assetLabel}调整值`);
  }

  switch (input.direction) {
    case 'add':
      return assertAdjustmentValue(Math.abs(input.amount), assetLabel);
    case 'subtract':
    case 'deduct':
    case 'reduce':
      return assertAdjustmentValue(-Math.abs(input.amount), assetLabel);
    default:
      return assertAdjustmentValue(input.amount, assetLabel);
  }
}
