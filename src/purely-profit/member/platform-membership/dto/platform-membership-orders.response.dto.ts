import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PaginationMetaDto } from '../../../stores/dto/store-response.dto';
import { PLATFORM_MEMBERSHIP_ORDER_STATUS } from './platform-membership-enums.dto';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from './platform-membership-query.dto';
import { PlatformMembershipProfileResponseDto } from './platform-membership-shared.response.dto';

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

  @ApiProperty({ example: 1500, description: '实际使用积分数量' })
  @IsInt({ message: '使用积分数量必须是整数' })
  pointsUsed: number;

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
    description: '充值记录页汇总信息（仅统计已支付订单）',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipOrdersOverviewDto)
  overview: PlatformMembershipOrdersOverviewDto;

  @ApiProperty({
    type: [PlatformMembershipOrderResponseDto],
    description: '充值记录列表，按创建时间倒序（当前页）',
  })
  @IsArray({ message: '充值记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipOrderResponseDto)
  items: PlatformMembershipOrderResponseDto[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: '分页元信息',
  })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta: PaginationMetaDto;
}

export class PreviewPlatformMembershipOrderResponseDto {
  @ApiProperty({ example: 3800, description: '套餐原价，单位分' })
  @IsInt({ message: '套餐原价必须是整数' })
  planPrice: number;

  @ApiProperty({ example: 300, description: '纯利豆抵扣金额，单位分' })
  @IsInt({ message: '纯利豆抵扣金额必须是整数' })
  beanDeductAmount: number;

  @ApiProperty({ example: 3, description: '实际使用纯利豆数量' })
  @IsInt({ message: '实际使用纯利豆数量必须是整数' })
  actualBeansUsed: number;

  @ApiProperty({ example: 200, description: '积分抵扣金额，单位分' })
  @IsInt({ message: '积分抵扣金额必须是整数' })
  pointsDeductAmount: number;

  @ApiProperty({ example: 200, description: '实际使用积分数量' })
  @IsInt({ message: '实际使用积分数量必须是整数' })
  actualPointsUsed: number;

  @ApiProperty({ example: 3300, description: '最终应付金额，单位分' })
  @IsInt({ message: '最终应付金额必须是整数' })
  finalAmount: number;

  @ApiProperty({ example: 1140, description: '纯利豆最大可抵扣金额，单位分' })
  @IsInt({ message: '纯利豆最大可抵扣金额必须是整数' })
  maxBeanDeductAmount: number;

  @ApiProperty({ example: 1140, description: '积分最大可抵扣金额，单位分' })
  @IsInt({ message: '积分最大可抵扣金额必须是整数' })
  maxPointsDeductAmount: number;

  @ApiProperty({ example: true, description: '当前是否有足够积分可用' })
  canUsePoints: boolean;

  @ApiProperty({ example: true, description: '当前是否有足够纯利豆可用' })
  canUseBeans: boolean;
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

/** 平台支付单状态轮询结果 */
export class PlatformPaymentStatusDto {
  /** pending / paid / closed / failed */
  @ApiProperty({
    enum: ['pending', 'paid', 'closed', 'failed'],
    description: '支付单状态',
  })
  status: string;

  /** 支付完成时间（未支付为 null） */
  @ApiPropertyOptional({ description: '支付完成时间（ISO 字符串）' })
  paidAt?: string | null;
}

/**
 * 购买会员的统一结果。
 *
 * 测试模式下 `order / profile / overview` 一定有值（权益当场生效）；
 * 真实模式下只有支付信息，权益要等支付回调，前端凭 `orderNo` 轮询状态。
 */
export class PurchaseMembershipResultDto {
  @ApiProperty({
    enum: ['test', 'live'],
    description: 'test=测试模式（已生效）/ live=真实模式（待扫码支付）',
  })
  mode: 'test' | 'live';

  @ApiPropertyOptional({ description: '平台支付单号（真实模式用于轮询）' })
  orderNo?: string;

  @ApiPropertyOptional({ description: '微信支付二维码链接（真实模式）' })
  codeUrl?: string;

  @ApiPropertyOptional({
    description: '支付二维码图片（PNG data URL，真实模式）',
  })
  qrCodeImageUrl?: string;

  @ApiPropertyOptional({ description: '应付金额（分），由后端算价得出' })
  amountFen?: number;

  @ApiPropertyOptional({ description: '支付单过期时间（ISO 字符串）' })
  expiresAt?: string;

  @ApiPropertyOptional({ type: PlatformMembershipOrderResponseDto })
  order?: PlatformMembershipOrderResponseDto;

  @ApiPropertyOptional({ type: PlatformMembershipProfileResponseDto })
  profile?: PlatformMembershipProfileResponseDto;

  @ApiPropertyOptional({ type: PlatformMembershipOrdersOverviewDto })
  overview?: PlatformMembershipOrdersOverviewDto;
}
