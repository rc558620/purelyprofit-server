import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  PULSE_MEMBER_LEVEL_VALUES,
  PULSE_MEMBER_STATUS_VALUES,
  PULSE_SUB_ACCOUNT_ROLE_VALUES,
  PULSE_SUB_ACCOUNT_STATUS_VALUES,
} from './pulse-membership-admin-members.shared.dto';
import type {
  PulseMemberLevelValue,
  PulseMemberStatusValue,
  PulseSubAccountRoleValue,
  PulseSubAccountStatusValue,
} from './pulse-membership-admin-members.shared.dto';

function toNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (value === undefined || value === '') {
    return undefined;
  }
  return Number(value);
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return undefined;
}

export class PulseAdminMemberMembershipDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    description: '目标会员等级',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  level?: PulseMemberLevelValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    description: '兼容旧请求的会员等级字段',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  memberLevel?: PulseMemberLevelValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    description: '兼容旧请求的会员等级字段',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  membershipLevel?: PulseMemberLevelValue;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '会员到期时间戳（ms）',
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '会员到期时间必须是整数时间戳' })
  membershipExpiry?: number | null;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '兼容旧请求的到期时间字段',
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '会员到期时间必须是整数时间戳' })
  expireAt?: number | null;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '兼容旧请求的到期时间字段',
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '会员到期时间必须是整数时间戳' })
  expiryAt?: number | null;

  @ApiPropertyOptional({
    example: true,
    description: '显式确认将当前生效会员降级为免费会员',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean({ message: '降级确认标记必须是布尔值' })
  confirmDowngradeToFree?: boolean;

  @ApiPropertyOptional({
    example: 'member-detail-membership-modal',
    description: '前端调用来源标识，便于排查会员等级变更入口',
  })
  @IsOptional()
  @IsString({ message: '调用来源标识必须是字符串' })
  actionSource?: string;
}

export class PulseAdminMemberSubAccountQuotaRoleSummaryDto {
  @ApiProperty({ example: 1, description: '子账号槽位序号，范围 1~10' })
  @Type(() => Number)
  @IsInt({ message: '槽位序号必须是整数' })
  @Min(1, { message: '槽位序号不能小于 1' })
  @Max(10, { message: '槽位序号不能超过 10' })
  slot: number;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色，仅支持 cashier / finance / manager',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES, { message: '子账号角色不合法' })
  role: PulseSubAccountRoleValue;

  @ApiPropertyOptional({
    enum: PULSE_SUB_ACCOUNT_STATUS_VALUES,
    description: '子账号状态，默认 active',
  })
  @IsOptional()
  @IsIn(PULSE_SUB_ACCOUNT_STATUS_VALUES, { message: '子账号状态不合法' })
  status?: PulseSubAccountStatusValue;

  @ApiPropertyOptional({ example: false, description: '是否已分配员工' })
  @IsOptional()
  @IsBoolean({ message: '是否已分配员工必须是布尔值' })
  isAssigned?: boolean;
}

export class PulseAdminMemberSubAccountQuotaDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 2, description: '目标子账号额度，范围 0~10' })
  @ValidateIf(
    (dto: PulseAdminMemberSubAccountQuotaDto) =>
      dto.subAccountQuota === undefined,
  )
  @Transform(({ value, obj }) => {
    const raw = value ?? obj?.subAccountQuota;
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    return Number(raw);
  })
  @IsInt({ message: '子账号额度必须是整数' })
  @Min(0, { message: '子账号额度不能小于 0' })
  @Max(10, { message: '子账号额度不能超过 10' })
  quota!: number;

  @ApiPropertyOptional({
    example: 2,
    description: '兼容旧请求的子账号额度字段，范围 0~10',
  })
  @IsOptional()
  @ValidateIf(
    (dto: PulseAdminMemberSubAccountQuotaDto) => dto.quota === undefined,
  )
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return Number(value);
  })
  @IsInt({ message: '子账号额度必须是整数' })
  @Min(0, { message: '子账号额度不能小于 0' })
  @Max(10, { message: '子账号额度不能超过 10' })
  subAccountQuota?: number;

  @ApiPropertyOptional({ example: '年会员权益升级', description: '调整原因' })
  @IsOptional()
  @IsString({ message: '调整原因必须是字符串' })
  @MaxLength(100, { message: '调整原因最多 100 位' })
  reason?: string;

  @ApiPropertyOptional({
    type: [PulseAdminMemberSubAccountQuotaRoleSummaryDto],
    description: '兼容 purelyPulse 前端的槽位角色摘要提交',
  })
  @IsOptional()
  @IsArray({ message: '槽位角色摘要必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberSubAccountQuotaRoleSummaryDto)
  roleSummary?: PulseAdminMemberSubAccountQuotaRoleSummaryDto[];
}

export class PulseAdminMemberSubAccountSlotDto {
  @ApiProperty({ example: 1, description: '子账号槽位序号，范围 1~10' })
  @Type(() => Number)
  @IsInt({ message: '槽位序号必须是整数' })
  @Min(1, { message: '槽位序号不能小于 1' })
  @Max(10, { message: '槽位序号不能超过 10' })
  slotIndex: number;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色，仅支持 cashier / finance / manager',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES, { message: '子账号角色不合法' })
  role: PulseSubAccountRoleValue;

  @ApiPropertyOptional({
    enum: PULSE_SUB_ACCOUNT_STATUS_VALUES,
    description: '子账号状态，默认 active',
  })
  @IsOptional()
  @IsIn(PULSE_SUB_ACCOUNT_STATUS_VALUES, { message: '子账号状态不合法' })
  status?: PulseSubAccountStatusValue;

  @ApiPropertyOptional({
    example: 18,
    description: '分配的员工 ID，不传或 null 表示清空分配',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return Number(value);
  })
  @IsInt({ message: '员工 ID 必须是整数' })
  employeeId?: number | null;

  @ApiPropertyOptional({
    example: true,
    description: '是否允许首页访问，默认跟随状态',
  })
  @IsOptional()
  @IsBoolean({ message: '首页访问开关必须是布尔值' })
  canAccessHome?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: '是否允许交班，默认跟随状态',
  })
  @IsOptional()
  @IsBoolean({ message: '交班开关必须是布尔值' })
  canUseHandover?: boolean;
}

export class PulseAdminMemberStatusDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_STATUS_VALUES,
    description: '目标会员状态',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  status?: PulseMemberStatusValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_STATUS_VALUES,
    description: '兼容旧请求的会员状态字段',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  memberStatus?: PulseMemberStatusValue;

  @ApiPropertyOptional({ example: '涉嫌异常操作', description: '操作原因' })
  @IsOptional()
  @IsString({ message: '操作原因必须是字符串' })
  @MaxLength(100, { message: '操作原因最多 100 位' })
  reason?: string;

  @ApiPropertyOptional({
    example: '涉嫌异常操作',
    description: '兼容旧请求的备注字段',
  })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 位' })
  remark?: string;
}

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

/**
 * GET /pulse/membership/admin/members
 * 管理员获取会员列表 — 查询参数
 */
export class GetPulseAdminMembersQueryDto {
  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_STATUS_VALUES,
    description: '会员状态筛选，不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_STATUS_VALUES, { message: '会员状态筛选不合法' })
  status?: PulseMemberFilterStatusValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_LEVEL_VALUES,
    description: '会员等级筛选，不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_LEVEL_VALUES, { message: '会员等级筛选不合法' })
  level?: PulseMemberFilterLevelValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_EXPIRY_VALUES,
    description: '会员到期时间筛选（相对当前时间），不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_EXPIRY_VALUES, { message: '会员到期时间筛选不合法' })
  expiry?: PulseMemberFilterExpiryValue;

  @ApiPropertyOptional({
    example: true,
    description: '是否仅返回合伙人，兼容 partner=true 查询',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean({ message: '合伙人筛选标记必须是布尔值' })
  partner?: boolean;

  @ApiPropertyOptional({
    example: '刘梅',
    description: '搜索关键词（姓名 / 手机号）',
  })
  @IsOptional()
  @IsString({ message: '搜索关键词必须是字符串' })
  keyword?: string;
}
