import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';
import { PLATFORM_MEMBERSHIP_ORDER_STATUS } from '../../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type { PulseMembershipPlanId } from '../membership.types';

export type { PulseMembershipPlanId } from '../membership.types';
export type PulseMembershipOrderStatus =
  (typeof PLATFORM_MEMBERSHIP_ORDER_STATUS)[number];

export class PulseMembershipPartnerLevelDto {
  @ApiPropertyOptional({
    example: 'elite',
    description: '合伙人等级，非合伙人时为空',
  })
  @IsOptional()
  @IsString()
  partnerLevel: string | null;

  @ApiProperty({ example: 12, description: '本月已充值推广人数' })
  @IsInt()
  monthChargedCount: number;

  @ApiPropertyOptional({
    example: 18,
    description: '距下一等级还差人数，最高等级时为空',
  })
  @IsOptional()
  @IsInt()
  monthCountToNextLevel: number | null;
}

export class PulseMembershipPromoStatsDto {
  @ApiProperty({ example: 8, description: '总推广人数' })
  @IsInt()
  totalPromos: number;

  @ApiProperty({ example: 3, description: '已充值推广人数' })
  @IsInt()
  chargedPromos: number;

  @ApiProperty({ example: 38, description: '推广成功率（百分比整数）' })
  @IsInt()
  promoRate: number;

  @ApiProperty({ example: 114, description: '通过推广累计获得纯利豆数量' })
  @IsInt()
  earnedBeans: number;
}

export class PulseMembershipPromoRecordDto {
  @ApiProperty({ example: 'promo-21', description: '推广记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '李四', description: '被推广用户昵称' })
  @IsString()
  inviteeName: string;

  @ApiProperty({
    example: '15900004321',
    description: '被推广用户手机号',
  })
  @IsString()
  inviteePhone: string;

  @ApiProperty({ example: 1747123200000, description: '注册时间戳（ms）' })
  @IsInt()
  registeredAt: number;

  @ApiProperty({ example: true, description: '是否已充值' })
  @IsBoolean()
  hasCharged: boolean;

  @ApiPropertyOptional({ example: 9900, description: '充值金额，单位分' })
  @IsOptional()
  @IsInt()
  chargedAmount: number | null;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '充值时间戳（ms）',
  })
  @IsOptional()
  @IsInt()
  chargedAt: number | null;

  @ApiPropertyOptional({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '充值套餐类型',
  })
  @IsOptional()
  @IsString()
  chargedPlan: PulseMembershipPlanId | null;

  @ApiPropertyOptional({ example: 22, description: '奖励纯利豆数量' })
  @IsOptional()
  @IsInt()
  rewardBeans: number | null;

  @ApiPropertyOptional({ example: false, description: '是否已结算' })
  @IsOptional()
  @IsBoolean()
  settled: boolean;
}
