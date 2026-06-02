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
import { PlatformMembershipPartnerLevelDto } from './platform-membership-partner.response.dto';
import {
  PlatformMembershipApprovedPartnerDto,
  PlatformMembershipInfoDto,
} from './platform-membership-shared.response.dto';

export class PlatformMembershipPromoStatsDto {
  @ApiProperty({ example: 8, description: '总推广人数' })
  @IsInt({ message: '总推广人数必须是整数' })
  totalPromos: number;

  @ApiProperty({ example: 3, description: '已充值推广人数' })
  @IsInt({ message: '已充值推广人数必须是整数' })
  chargedPromos: number;

  @ApiProperty({ example: 38, description: '推广成功率（百分比整数）' })
  @IsInt({ message: '推广成功率必须是整数' })
  promoRate: number;

  @ApiProperty({ example: 114, description: '通过推广累计获得纯利豆数量' })
  @IsInt({ message: '累计获得纯利豆数量必须是整数' })
  earnedBeans: number;
}

export class PlatformMembershipPromoRecordDto {
  @ApiProperty({ example: 'promo-21', description: '推广记录 ID' })
  @IsString({ message: '推广记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '李四', description: '被推广用户昵称' })
  @IsString({ message: '被推广用户昵称必须是字符串' })
  inviteeName: string;

  @ApiProperty({
    example: '159****4321',
    description: '被推广用户手机号（脱敏）',
  })
  @IsString({ message: '被推广用户手机号必须是字符串' })
  inviteePhone: string;

  @ApiProperty({ example: 1747123200000, description: '注册时间戳（ms）' })
  @IsInt({ message: '注册时间必须是整数' })
  registeredAt: number;

  @ApiProperty({ example: true, description: '是否已充值' })
  @IsBoolean({ message: '是否已充值必须是布尔值' })
  hasCharged: boolean;

  @ApiPropertyOptional({ example: 9900, description: '充值金额，单位分' })
  @IsOptional()
  @IsInt({ message: '充值金额必须是整数' })
  chargedAmount?: number;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '充值时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '充值时间必须是整数' })
  chargedAt?: number;

  @ApiPropertyOptional({
    example: 'quarterly',
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '充值套餐类型',
  })
  @IsOptional()
  @IsString({ message: '充值套餐类型必须是字符串' })
  chargedPlan?: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiPropertyOptional({ example: 22, description: '奖励纯利豆数量' })
  @IsOptional()
  @IsInt({ message: '奖励纯利豆数量必须是整数' })
  rewardBeans?: number;

  @ApiPropertyOptional({ example: false, description: '是否已结算' })
  @IsOptional()
  @IsBoolean({ message: '结算状态必须是布尔值' })
  settled?: boolean;
}

export class PlatformMembershipPromoStatsByPeriodDto {
  @ApiProperty({
    type: PlatformMembershipPromoStatsDto,
    description: '全部时间统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsDto)
  all: PlatformMembershipPromoStatsDto;

  @ApiProperty({
    type: PlatformMembershipPromoStatsDto,
    description: '今日统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsDto)
  today: PlatformMembershipPromoStatsDto;

  @ApiProperty({
    type: PlatformMembershipPromoStatsDto,
    description: '本月统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsDto)
  month: PlatformMembershipPromoStatsDto;

  @ApiProperty({
    type: PlatformMembershipPromoStatsDto,
    description: '本年统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsDto)
  year: PlatformMembershipPromoStatsDto;
}

export class PlatformMembershipPromoCenterResponseDto {
  @ApiProperty({
    type: PlatformMembershipInfoDto,
    description: '会员基础信息，用于推广码展示',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipInfoDto)
  memberInfo: PlatformMembershipInfoDto;

  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '兼容旧前端的主合伙人摘要',
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

  @ApiProperty({
    type: PlatformMembershipPartnerLevelDto,
    description: '合伙人等级信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPartnerLevelDto)
  level: PlatformMembershipPartnerLevelDto;

  @ApiProperty({
    type: PlatformMembershipPromoStatsDto,
    description: '推广中心统计信息（全量）',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsDto)
  stats: PlatformMembershipPromoStatsDto;

  @ApiProperty({
    type: PlatformMembershipPromoStatsByPeriodDto,
    description: '按时间维度拆分的推广统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsByPeriodDto)
  statsByPeriod: PlatformMembershipPromoStatsByPeriodDto;

  @ApiProperty({
    type: [PlatformMembershipPromoRecordDto],
    description: '推广记录列表，按注册时间倒序',
  })
  @IsArray({ message: '推广记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipPromoRecordDto)
  items: PlatformMembershipPromoRecordDto[];
}
