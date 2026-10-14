// Pulse / 管理端会员成交价快照 DTO

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import {
  PULSE_LOCKED_PRICE_SOURCE_VALUES,
  PULSE_MEMBERSHIP_PLAN_ID_VALUES,
} from './pulse-membership-admin-members.constants';
import type {
  PulseLockedPriceSourceValue,
  PulseMembershipPlanIdValue,
} from './pulse-membership-admin-members.constants';

/**
 * 成交价快照条目（管理端展示）。
 *
 * 定价公式为 `当前配置价 + 子账号加价`：子账号加价是唯一的长期锁定分量，
 * 成交总额（price）只作记账，不参与定价。
 *
 * 对齐前端 MemberLockedPrice（purelyPulse memberList.types.ts）。
 */
export class PulseAdminMemberLockedPriceDto {
  @ApiProperty({
    enum: PULSE_MEMBERSHIP_PLAN_ID_VALUES,
    example: 'yearly',
    description: '套餐档位（yearly 对应前端展示的「年度会员」）',
  })
  @IsIn(PULSE_MEMBERSHIP_PLAN_ID_VALUES)
  planId: PulseMembershipPlanIdValue;

  @ApiProperty({ example: 58800, description: '成交总额（分）' })
  @IsInt()
  price: number;

  @ApiPropertyOptional({
    example: '150',
    description:
      '该档位包含的子账号加价（元，已格式化）。null 表示运营尚未补录，' +
      '此时该门店续费会退化为 max(当前配置价, 成交总额)，配置价涨过成交总额即白送子账号',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  subAccountAmountDisplay: string | null;

  @ApiPropertyOptional({
    example: 3,
    description: '该档位包含的子账号数量；null 表示运营尚未补录',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  subAccountCount: number | null;

  @ApiPropertyOptional({
    example: '350',
    description:
      '该档位议定的基础价（元，已格式化，入库原值）。null 表示未议定。' +
      '实际定价基数为 max(当前配置价, 议定价)，因此它低于配置价时不再生效；' +
      '年 / 永久档位的子账号加价仍然叠加',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  renewalPriceOverrideDisplay: string | null;

  @ApiPropertyOptional({
    example: '498',
    description:
      '续费价 = max(当前配置价, 议定价) + 子账号加价（元，已格式化）。' +
      '仅当该档位录了子账号加价、或有议定价时下发，' +
      '供快照展示「加价 ¥100 = ¥498」',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  renewalPriceDisplay: string | null;

  @ApiProperty({ example: '588', description: '锁定价格（元，已格式化）' })
  @IsString()
  priceDisplay: string;

  @ApiProperty({
    enum: PULSE_LOCKED_PRICE_SOURCE_VALUES,
    example: 'purchase',
    description: '锁价来源',
  })
  @IsIn(PULSE_LOCKED_PRICE_SOURCE_VALUES)
  source: PulseLockedPriceSourceValue;

  @ApiProperty({
    example: 1773500000000,
    description: '锁定时点（ms）',
  })
  @IsInt()
  lockedAt: number;
}
