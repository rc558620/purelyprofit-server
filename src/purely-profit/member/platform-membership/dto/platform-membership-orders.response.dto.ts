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
  PLATFORM_MEMBERSHIP_ORDER_STATUS,
  PlatformMembershipProfileResponseDto,
} from './platform-membership-shared.response.dto';

export class PlatformMembershipOrderResponseDto {
  @ApiProperty({ example: '21', description: '订单 ID' })
  @IsString({ message: '订单 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '套餐周期标识',
  })
  @IsString({ message: '套餐周期标识必须是字符串' })
  planId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiProperty({ example: '季度会员', description: '套餐名称' })
  @IsString({ message: '套餐名称必须是字符串' })
  planName: string;

  @ApiProperty({ example: 9900, description: '实付金额，单位分' })
  @IsInt({ message: '实付金额必须是整数' })
  amount: number;

  @ApiProperty({ example: 1500, description: '积分抵扣金额，单位分' })
  @IsInt({ message: '积分抵扣金额必须是整数' })
  pointsDeducted: number;

  @ApiProperty({ example: 1500, description: '实际使用积分数量' })
  @IsInt({ message: '使用积分数量必须是整数' })
  pointsUsed: number;

  @ApiProperty({ example: 2000, description: '纯利豆抵扣金额，单位分' })
  @IsInt({ message: '纯利豆抵扣金额必须是整数' })
  beanDeducted: number;

  @ApiProperty({ example: 20, description: '实际使用纯利豆数量' })
  @IsInt({ message: '使用纯利豆数量必须是整数' })
  beansUsed: number;

  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_ORDER_STATUS,
    description: '订单状态，和前端 OrderStatus 保持一致',
  })
  @IsString({ message: '订单状态必须是字符串' })
  status: (typeof PLATFORM_MEMBERSHIP_ORDER_STATUS)[number];

  @ApiProperty({ example: 1773556800000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 'WX181773556800000',
    description: '微信支付订单号，无则为空',
  })
  @IsOptional()
  @IsString({ message: '微信订单号必须是字符串' })
  wxOrderId?: string;
}

export class PlatformMembershipOrdersOverviewDto {
  @ApiProperty({ example: 3, description: '充值次数' })
  @IsInt({ message: '充值次数必须是整数' })
  orderCount: number;

  @ApiProperty({ example: 46800, description: '累计消费金额，单位分' })
  @IsInt({ message: '累计消费金额必须是整数' })
  totalAmount: number;
}

export class PlatformMembershipOrdersResponseDto {
  @ApiProperty({
    type: PlatformMembershipOrdersOverviewDto,
    description: '充值记录页汇总信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipOrdersOverviewDto)
  overview: PlatformMembershipOrdersOverviewDto;

  @ApiProperty({
    type: [PlatformMembershipOrderResponseDto],
    description: '充值记录列表，按创建时间倒序',
  })
  @IsArray({ message: '充值记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipOrderResponseDto)
  items: PlatformMembershipOrderResponseDto[];
}

export class PurchasePlatformMembershipOrderResponseDto {
  @ApiProperty({
    type: PlatformMembershipOrderResponseDto,
    description: '最新创建的订单',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipOrderResponseDto)
  order: PlatformMembershipOrderResponseDto;

  @ApiProperty({
    type: PlatformMembershipProfileResponseDto,
    description: '支付后的会员信息与可用纯利豆',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipProfileResponseDto)
  profile: PlatformMembershipProfileResponseDto;

  @ApiProperty({
    type: PlatformMembershipOrdersOverviewDto,
    description: '支付成功后的最新充值汇总',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipOrdersOverviewDto)
  overview: PlatformMembershipOrdersOverviewDto;
}
