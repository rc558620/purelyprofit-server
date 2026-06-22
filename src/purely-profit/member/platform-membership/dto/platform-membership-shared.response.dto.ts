import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from './platform-membership-query.dto';

export const PLATFORM_MEMBERSHIP_ORDER_STATUS = [
  'pending',
  'paid',
  'failed',
  'refunded',
] as const;

export const PLATFORM_PARTNER_STATUS = [
  'pending',
  'reviewing',
  'approved',
  'rejected',
] as const;

export const PLATFORM_POINTS_RECORD_TYPES = [
  'earn',
  'spend',
  'expire',
] as const;
export const PLATFORM_POINTS_RECORD_SOURCES = [
  'purchase_bonus',
  'deduct_payment',
  'admin_adjust',
  'expire',
] as const;

export const PLATFORM_BEAN_RECORD_TYPES = [
  'earn',
  'spend',
  'withdraw',
] as const;
export const PLATFORM_BEAN_RECORD_SOURCES = [
  'promo_reward',
  'deduct_payment',
  'withdrawal',
  'admin_adjust',
] as const;

export const PLATFORM_PARTNER_LEVEL_VALUES = [
  'star',
  'elite',
  'legend',
] as const;

export class PlatformMembershipPlanResponseDto {
  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '套餐标识，和前端 MemberPlan.id 保持一致',
  })
  @IsString({ message: '套餐标识必须是字符串' })
  id: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiProperty({ example: '季度会员', description: '套餐名称' })
  @IsString({ message: '套餐名称必须是字符串' })
  name: string;

  @ApiProperty({ example: 9900, description: '套餐价格，单位分' })
  @IsInt({ message: '套餐价格必须是整数' })
  price: number;

  @ApiPropertyOptional({
    example: 11400,
    description: '原价，单位分；永久会员可为空',
  })
  @IsOptional()
  @IsInt({ message: '套餐原价必须是整数' })
  originalPrice?: number | null;

  @ApiPropertyOptional({
    example: 3,
    description: '时长（月）；永久会员为空',
  })
  @IsOptional()
  @IsInt({ message: '套餐时长必须是整数' })
  durationMonths?: number | null;

  @ApiPropertyOptional({
    example: 730,
    description: '有效期天数；永久会员返回该字段',
  })
  @IsOptional()
  @IsInt({ message: '有效期天数必须是整数' })
  validDays?: number | null;

  @ApiPropertyOptional({ example: '省15元', description: '套餐角标文案' })
  @IsOptional()
  @IsString({ message: '套餐角标必须是字符串' })
  badge?: string;

  @ApiPropertyOptional({ example: true, description: '是否为主推套餐' })
  @IsOptional()
  recommended?: boolean;

  @ApiPropertyOptional({
    example: 3300,
    description: '月均价格，单位分；永久会员可为空',
  })
  @IsOptional()
  @IsInt({ message: '月均价格必须是整数' })
  monthlyPrice?: number;
}

export class PlatformMembershipPlanRuleRowDto {
  @ApiProperty({ example: 'product_limit', description: '规则标识' })
  @IsString({ message: '规则标识必须是字符串' })
  key: string;

  @ApiProperty({ example: '商品录入', description: '规则名称' })
  @IsString({ message: '规则名称必须是字符串' })
  name: string;

  @ApiProperty({ example: '最多 3 个', description: '免费版规则文案' })
  @IsString({ message: '免费版规则文案必须是字符串' })
  free: string;

  @ApiProperty({ example: '最多 30 个', description: '月度会员规则文案' })
  @IsString({ message: '月度会员规则文案必须是字符串' })
  monthly: string;

  @ApiProperty({ example: '最多 100 个', description: '季度会员规则文案' })
  @IsString({ message: '季度会员规则文案必须是字符串' })
  quarterly: string;

  @ApiProperty({ example: '无上限', description: '年度会员规则文案' })
  @IsString({ message: '年度会员规则文案必须是字符串' })
  yearly: string;
}

export class PlatformMembershipPlanRulesResponseDto {
  @ApiProperty({
    type: [PlatformMembershipPlanRuleRowDto],
    description: '套餐对比规则表，按前端 memberPlans 页面顺序返回',
  })
  @IsArray({ message: '套餐规则列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipPlanRuleRowDto)
  rows: PlatformMembershipPlanRuleRowDto[];
}

export class PlatformMembershipInfoDto {
  @ApiProperty({ example: true, description: '当前是否为有效会员' })
  @IsBoolean({ message: '会员状态必须是布尔值' })
  isActive: boolean;

  @ApiPropertyOptional({
    enum: [...PLATFORM_MEMBERSHIP_PLAN_IDS, 'developer'],
    description: '当前生效套餐标识，开发者模式返回 developer，无生效套餐时为空',
  })
  @IsOptional()
  @IsString({ message: '当前套餐标识必须是字符串' })
  planId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number] | 'developer' | null;

  @ApiPropertyOptional({
    example: 'ages会员',
    description: '面向前端展示的套餐名称，无特殊展示需求时为空',
  })
  @IsOptional()
  @IsString({ message: '展示套餐名称必须是字符串' })
  displayPlanName?: string | null;

  @ApiPropertyOptional({
    example: 1776153600000,
    description: '到期时间戳（ms），未开通时为空',
  })
  @IsOptional()
  @IsInt({ message: '到期时间必须是整数' })
  expiredAt: number | null;

  @ApiProperty({ example: 'ABCD23', description: '邀请码（推广码）' })
  @IsString({ message: '邀请码必须是字符串' })
  inviteCode: string;

  @ApiProperty({ example: 1880, description: '累计积分' })
  @IsInt({ message: '累计积分必须是整数' })
  totalPoints: number;

  @ApiProperty({ example: 1280, description: '可用积分' })
  @IsInt({ message: '可用积分必须是整数' })
  availablePoints: number;
}

export class PlatformMembershipApprovedPartnerDto {
  @ApiProperty({ example: '12', description: '正式合伙人档案 ID' })
  @IsString({ message: '正式合伙人档案 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '王建国', description: '合伙人姓名' })
  @IsString({ message: '合伙人姓名必须是字符串' })
  name: string;

  @ApiProperty({ example: '13800138000', description: '合伙人联系电话' })
  @IsString({ message: '联系电话必须是字符串' })
  phone: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar.jpg',
    description: '合伙人头像 URL，未设置时为空串',
  })
  @IsOptional()
  @IsString({ message: '头像 URL 必须是字符串' })
  avatarUrl?: string;

  @ApiPropertyOptional({
    example: 1747123200000,
    description: '成为合伙人的时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '成为合伙人的时间必须是整数' })
  joinedAt?: number;

  @ApiProperty({ example: 114, description: '当前可用纯利豆余额' })
  @IsInt({ message: '纯利豆余额必须是整数' })
  beanBalance: number;

  @ApiProperty({ example: 320, description: '累计获得纯利豆数量' })
  @IsInt({ message: '累计获得纯利豆数量必须是整数' })
  totalEarnedBeans: number;

  @ApiProperty({ example: 120, description: '累计提现纯利豆数量' })
  @IsInt({ message: '累计提现纯利豆数量必须是整数' })
  totalWithdrawnBeans: number;
}

export class PlatformMembershipProfileResponseDto {
  @ApiProperty({
    type: PlatformMembershipInfoDto,
    description: '会员中心头部信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipInfoDto)
  memberInfo: PlatformMembershipInfoDto;

  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '兼容旧前端的主合伙人摘要，无则为空',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;

  @ApiProperty({
    type: [PlatformMembershipApprovedPartnerDto],
    description: '当前门店全部正式合伙人列表',
  })
  @IsArray({ message: '正式合伙人列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartners: PlatformMembershipApprovedPartnerDto[];
}

export class PlatformMembershipCenterStatsDto {
  @ApiProperty({ example: 2, description: '推广合伙人数量' })
  @IsInt({ message: '推广合伙人数量必须是整数' })
  partnerCount: number;

  @ApiProperty({ example: 8, description: '总推广人数' })
  @IsInt({ message: '总推广人数必须是整数' })
  totalPromos: number;

  @ApiProperty({ example: 3, description: '已充值推广人数' })
  @IsInt({ message: '已充值推广人数必须是整数' })
  chargedPromos: number;
}
