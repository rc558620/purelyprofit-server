import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type {
  PulseRechargeChannelValue,
  PulseSubAccountRoleValue,
  PulseSubAccountStatusValue,
} from '../membership.types';

export type {
  PulseMemberLevelValue,
  PulseMemberStatusValue,
  PulseRechargeChannelValue,
  PulseSubAccountRoleValue,
  PulseSubAccountStatusValue,
} from '../membership.types';

/**
 * 会员状态（对齐前端 MemberStatus）
 */
export const PULSE_MEMBER_STATUS_VALUES = [
  'active',
  'inactive',
  'banned',
] as const;
/**
 * 会员等级（对齐前端 MemberLevel）
 */
export const PULSE_MEMBER_LEVEL_VALUES = [
  'free',
  'monthly',
  'quarterly',
  'annual',
  'lifetime',
] as const;
/**
 * 充值支付渠道（对齐前端 RechargeRecord.channel）
 */
export const PULSE_RECHARGE_CHANNEL_VALUES = [
  'wechat',
  'alipay',
  'card',
] as const;
/**
 * 充值记录（对齐前端 RechargeRecord）
 */
export class PulseRechargeRecordDto {
  @ApiProperty({ example: 'rc-001', description: '充值记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '年卡会员', description: '套餐名称' })
  @IsString()
  planName: string;

  @ApiProperty({ example: 29800, description: '充值金额（分）' })
  @IsInt()
  amount: number;

  @ApiProperty({
    example: '298',
    description: '充值金额展示值（元，字符串），后端直接计算，前端仅展示',
  })
  @IsString()
  amountDisplay: string;

  @ApiProperty({
    example: 500,
    description: '积分奖励（对齐前端 RechargeRecord.pointsAwarded）',
  })
  @IsInt()
  pointsAwarded: number;

  @ApiProperty({
    enum: PULSE_RECHARGE_CHANNEL_VALUES,
    example: 'wechat',
    description:
      '支付渠道：wechat=微信 / alipay=支付宝 / card=银行卡（对齐前端 RechargeRecord.channel）',
  })
  @IsIn(PULSE_RECHARGE_CHANNEL_VALUES)
  channel: PulseRechargeChannelValue;

  @ApiProperty({ example: 1747123200000, description: '充值时间戳（ms）' })
  @IsInt()
  createdAt: number;
}

export const PULSE_SUB_ACCOUNT_ROLE_VALUES = [
  'cashier',
  'finance',
  'manager',
] as const;
export const PULSE_SUB_ACCOUNT_STATUS_VALUES = [
  'active',
  'inactive',
  'disabled',
] as const;
export class PulseSubAccountRoleSummaryDto {
  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES)
  role: PulseSubAccountRoleValue;

  @ApiProperty({ example: 2, description: '激活槽位数量' })
  @IsInt()
  activeCount: number;

  @ApiProperty({ example: 1, description: '停用槽位数量' })
  @IsInt()
  inactiveCount: number;

  @ApiProperty({ example: 0, description: '禁用槽位数量' })
  @IsInt()
  disabledCount: number;

  @ApiProperty({ example: 2, description: '已分配数量' })
  @IsInt()
  assignedCount: number;
}

export class PulseSubAccountSlotDto {
  @ApiProperty({ example: '12', description: '子账号槽位 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: 1, description: '槽位序号，范围 1~10' })
  @IsInt()
  slotIndex: number;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES)
  role: PulseSubAccountRoleValue;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_STATUS_VALUES,
    description: '子账号状态',
  })
  @IsIn(PULSE_SUB_ACCOUNT_STATUS_VALUES)
  status: PulseSubAccountStatusValue;

  @ApiProperty({ example: false, description: '是否已分配员工' })
  @IsBoolean()
  isAssigned: boolean;

  @ApiPropertyOptional({ example: '18', description: '已分配员工 ID' })
  @IsOptional()
  @IsString()
  employeeId?: string | null;

  @ApiPropertyOptional({ example: '小李', description: '已分配员工姓名' })
  @IsOptional()
  @IsString()
  employeeName?: string | null;

  @ApiProperty({ example: true, description: '是否允许首页访问' })
  @IsBoolean()
  canAccessHome: boolean;

  @ApiProperty({ example: true, description: '是否允许交班' })
  @IsBoolean()
  canUseHandover: boolean;
}

export class PulseSubAccountCapabilityRoleSummaryItemDto {
  @ApiProperty({ example: 1, description: '子账号槽位序号，范围 1~10' })
  @IsInt()
  slot: number;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES)
  role: PulseSubAccountRoleValue;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_STATUS_VALUES,
    description: '子账号状态',
  })
  @IsIn(PULSE_SUB_ACCOUNT_STATUS_VALUES)
  status: PulseSubAccountStatusValue;

  @ApiProperty({ example: false, description: '是否已分配员工' })
  @IsBoolean()
  isAssigned: boolean;
}

export class PulseSubAccountCapabilityDto {
  @ApiProperty({ example: 2, description: '当前子账号额度' })
  @IsInt()
  subAccountQuota: number;

  @ApiProperty({ example: true, description: '是否具备配置子账号资格' })
  @IsBoolean()
  subAccountEligible: boolean;

  @ApiProperty({ example: true, description: '是否已启用子账号能力' })
  @IsBoolean()
  subAccountCapabilityEnabled: boolean;

  @ApiProperty({ example: 10, description: '当前会员允许配置的子账号上限' })
  @IsInt()
  subAccountQuotaMax: number;

  @ApiProperty({ example: 2, description: '已使用子账号数量' })
  @IsInt()
  subAccountsUsedCount: number;

  @ApiProperty({ example: 8, description: '剩余可分配子账号数量' })
  @IsInt()
  subAccountsAvailableCount: number;

  @ApiProperty({
    type: [PulseSubAccountCapabilityRoleSummaryItemDto],
    description: '前端子账号配置弹窗使用的槽位摘要列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseSubAccountCapabilityRoleSummaryItemDto)
  subAccountRoleSummary: PulseSubAccountCapabilityRoleSummaryItemDto[];
}

/* ────────────────── Transform helpers ────────────────── */

export function toNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (value === undefined || value === '') {
    return undefined;
  }
  return Number(value);
}

export function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return undefined;
}

/* ────────────────── Filter constants ────────────────── */

/**
 * 会员列表筛选状态（对齐前端 MemberFilterStatus / MemberFilterLevel）
 */
export const PULSE_MEMBER_FILTER_STATUS_VALUES = [
  'all',
  'active',
  'inactive',
  'banned',
] as const;
export type PulseMemberFilterStatusValue =
  (typeof PULSE_MEMBER_FILTER_STATUS_VALUES)[number];

export const PULSE_MEMBER_FILTER_LEVEL_VALUES = [
  'all',
  'free',
  'monthly',
  'quarterly',
  'annual',
  'lifetime',
] as const;
export type PulseMemberFilterLevelValue =
  (typeof PULSE_MEMBER_FILTER_LEVEL_VALUES)[number];

/**
 * 会员到期时间筛选（对齐前端 MemberFilterExpiry）
 */
export const PULSE_MEMBER_FILTER_EXPIRY_VALUES = [
  'all',
  '1m',
  '3m',
  '6m',
  '1y',
  '2y',
] as const;
export type PulseMemberFilterExpiryValue =
  (typeof PULSE_MEMBER_FILTER_EXPIRY_VALUES)[number];
