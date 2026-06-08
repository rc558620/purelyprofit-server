import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from './platform-membership-query.dto';
import {
  PLATFORM_BEAN_RECORD_SOURCES,
  PLATFORM_BEAN_RECORD_TYPES,
  PlatformMembershipApprovedPartnerDto,
} from './platform-membership-shared.response.dto';

export class PlatformMembershipBeanOverviewDto {
  @ApiProperty({ example: 114, description: '当前纯利豆余额' })
  @IsInt({ message: '当前纯利豆余额必须是整数' })
  beanBalance: number;

  @ApiProperty({ example: 320, description: '累计获得纯利豆数量' })
  @IsInt({ message: '累计获得纯利豆数量必须是整数' })
  totalEarnedBeans: number;

  @ApiProperty({ example: 120, description: '累计提现纯利豆数量' })
  @IsInt({ message: '累计提现纯利豆数量必须是整数' })
  totalWithdrawnBeans: number;
}

export class PlatformMembershipBeanLogDto {
  @ApiProperty({ example: 'bean-11', description: '纯利豆记录 ID' })
  @IsString({ message: '纯利豆记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    example: -20,
    description: '纯利豆变动值，正数=获得，负数=消耗/提现',
  })
  @IsInt({ message: '纯利豆变动值必须是整数' })
  amount: number;

  @ApiProperty({
    enum: PLATFORM_BEAN_RECORD_TYPES,
    example: 'spend',
    description: '纯利豆变动类型',
  })
  @IsString({ message: '纯利豆变动类型必须是字符串' })
  type: (typeof PLATFORM_BEAN_RECORD_TYPES)[number];

  @ApiProperty({
    enum: PLATFORM_BEAN_RECORD_SOURCES,
    example: 'deduct_payment',
    description: '纯利豆来源',
  })
  @IsString({ message: '纯利豆来源必须是字符串' })
  source: (typeof PLATFORM_BEAN_RECORD_SOURCES)[number];

  @ApiProperty({
    example: '纯利豆抵扣 · 订阅季度会员',
    description: '来源描述',
  })
  @IsString({ message: '来源描述必须是字符串' })
  description: string;

  @ApiPropertyOptional({ example: 'promo-21', description: '关联推广记录 ID' })
  @IsOptional()
  @IsString({ message: '关联推广记录 ID 必须是字符串' })
  relatedPromoId?: string;

  @ApiPropertyOptional({
    example: 'yearly',
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '关联的充值套餐类型',
  })
  @IsOptional()
  @IsString({ message: '关联套餐类型必须是字符串' })
  relatedPlanType?: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiPropertyOptional({
    example: '187****3344',
    description: '关联被推广用户',
  })
  @IsOptional()
  @IsString({ message: '关联被推广用户必须是字符串' })
  relatedUser?: string;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;
}

export class PlatformMembershipBeanLogsResponseDto {
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
    type: PlatformMembershipBeanOverviewDto,
    description: '纯利豆中心汇总信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipBeanOverviewDto)
  overview: PlatformMembershipBeanOverviewDto;

  @ApiProperty({
    type: [PlatformMembershipBeanLogDto],
    description: '纯利豆记录列表，按创建时间倒序',
  })
  @IsArray({ message: '纯利豆记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipBeanLogDto)
  items: PlatformMembershipBeanLogDto[];
}
