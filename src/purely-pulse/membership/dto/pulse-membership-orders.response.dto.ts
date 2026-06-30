import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PLATFORM_MEMBERSHIP_ORDER_STATUS } from '../../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import {
  PulseMembershipPartnerLevelDto,
  PulseMembershipPromoRecordDto,
  PulseMembershipPromoStatsDto,
} from './pulse-membership-orders.shared.dto';
import type {
  PulseMembershipOrderStatus,
  PulseMembershipPlanId,
} from './pulse-membership-orders.shared.dto';

/**
 * 下单试算结果：前端用于呈现价格拆解明细
 */
export class PulseMembershipOrderPreviewResponseDto {
  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '套餐周期标识',
  })
  @IsString()
  planId: PulseMembershipPlanId;

  @ApiProperty({ example: '季度会员', description: '套餐名称' })
  @IsString()
  planName: string;

  @ApiProperty({ example: 9900, description: '套餐原始价格，单位分' })
  @IsInt()
  originalPrice: number;

  @ApiProperty({
    example: 2000,
    description: '纯利豆抵扣金额，单位分（0 = 不抵扣）',
  })
  @IsInt()
  beanDeducted: number;

  @ApiProperty({ example: 20, description: '实际消耗纯利豆数量' })
  @IsInt()
  beansUsed: number;

  @ApiProperty({ example: 7900, description: '纯利豆抵扣后的价格，单位分' })
  @IsInt()
  priceAfterBeans: number;

  @ApiProperty({
    example: 1500,
    description: '积分抵扣金额，单位分（0 = 不抵扣）',
  })
  @IsInt()
  pointsDeducted: number;

  @ApiProperty({ example: 1500, description: '实际消耗积分数量' })
  @IsInt()
  pointsUsed: number;

  @ApiProperty({ example: 6400, description: '最终应付金额，单位分' })
  @IsInt()
  finalAmount: number;

  @ApiProperty({ example: 300, description: '购买该套餐可获得的积分奖励' })
  @IsInt()
  bonusPoints: number;

  @ApiProperty({ example: 1280, description: '用户当前可用积分' })
  @IsInt()
  availablePoints: number;

  @ApiProperty({
    example: 114,
    description: '用户当前可用纯利豆（非合伙人时为 0）',
  })
  @IsInt()
  availableBeans: number;

  @ApiProperty({ example: 4950, description: '纯利豆最大可抵扣金额，单位分' })
  @IsInt()
  maxBeanDeductAmount: number;

  @ApiProperty({ example: 2370, description: '积分最大可抵扣金额，单位分' })
  @IsInt()
  maxPointsDeductAmount: number;

  @ApiProperty({ example: true, description: '当前是否有足够积分可用' })
  @IsBoolean()
  canUsePoints: boolean;

  @ApiProperty({ example: true, description: '当前是否有足够纯利豆可用' })
  @IsBoolean()
  canUseBeans: boolean;
}

/**
 * GET /pulse/membership/orders/:id
 * 单订单详情
 */
export class PulseMembershipOrderDetailResponseDto {
  @ApiProperty({ example: '21', description: '订单 ID' })
  @IsString()
  id: string;

  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '套餐周期标识',
  })
  @IsString()
  planId: PulseMembershipPlanId;

  @ApiProperty({ example: '季度会员', description: '套餐名称' })
  @IsString()
  planName: string;

  @ApiProperty({ example: 9900, description: '套餐原始价格，单位分' })
  @IsInt()
  originalAmount: number;

  @ApiProperty({ example: 9900, description: '实付金额，单位分' })
  @IsInt()
  amount: number;

  @ApiProperty({ example: 1500, description: '实际使用积分数量' })
  @IsInt()
  pointsUsed: number;

  @ApiProperty({ example: 20, description: '实际使用纯利豆数量' })
  @IsInt()
  beansUsed: number;

  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_ORDER_STATUS,
    description: '订单状态',
  })
  @IsString()
  status: PulseMembershipOrderStatus;

  @ApiPropertyOptional({
    example: 'WX181773556800000',
    description: '微信支付订单号，无则为空',
  })
  @IsOptional()
  @IsString()
  wxOrderId: string | null;

  @ApiProperty({ example: 1773556800000, description: '创建时间戳（ms）' })
  @IsInt()
  createdAt: number;

  @ApiPropertyOptional({
    example: 1773556900000,
    description: '支付时间戳（ms），未支付时为空',
  })
  @IsOptional()
  @IsInt()
  paidAt: number | null;
}

/**
 * GET /pulse/membership/orders/:id/pay-status
 * 支付状态查询（轮询）
 */
export class PulseMembershipOrderPayStatusResponseDto {
  @ApiProperty({ example: '21', description: '订单 ID' })
  @IsString()
  id: string;

  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_ORDER_STATUS,
    description: '订单当前状态',
  })
  @IsString()
  status: PulseMembershipOrderStatus;

  @ApiProperty({ example: false, description: '是否已完成支付' })
  @IsBoolean()
  isPaid: boolean;

  @ApiPropertyOptional({
    example: 1773556900000,
    description: '支付时间戳（ms）',
  })
  @IsOptional()
  @IsInt()
  paidAt: number | null;
}

export class PulseMembershipPromoCenterResponseDto {
  @ApiProperty({ example: 'ABCD23', description: '推广码' })
  @IsString()
  inviteCode: string;

  @ApiProperty({
    type: PulseMembershipPartnerLevelDto,
    description: '合伙人等级信息',
  })
  @ValidateNested()
  @Type(() => PulseMembershipPartnerLevelDto)
  level: PulseMembershipPartnerLevelDto;

  @ApiProperty({
    type: PulseMembershipPromoStatsDto,
    description: '推广中心全量统计',
  })
  @ValidateNested()
  @Type(() => PulseMembershipPromoStatsDto)
  stats: PulseMembershipPromoStatsDto;

  @ApiProperty({
    type: [PulseMembershipPromoRecordDto],
    description: '推广记录列表',
  })
  @ValidateNested({ each: true })
  @Type(() => PulseMembershipPromoRecordDto)
  items: PulseMembershipPromoRecordDto[];
}
