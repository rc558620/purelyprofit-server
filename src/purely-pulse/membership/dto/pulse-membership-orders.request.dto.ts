import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type { PulseMembershipPlanId } from './pulse-membership-orders.shared.dto';

/**
 * POST /pulse/membership/orders/preview
 * 下单试算：传入套餐 + 希望使用的积分/纯利豆，返回价格拆解预览
 */
export class PulseMembershipOrderPreviewDto {
  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '会员套餐周期',
  })
  @IsString({ message: '套餐周期不合法' })
  planId: PulseMembershipPlanId;

  @ApiPropertyOptional({
    example: 1200,
    description: '希望使用的积分数量（可选，默认 0）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '积分数量必须是整数' })
  @Min(0, { message: '积分数量不能小于 0' })
  usePoints?: number;

  @ApiPropertyOptional({
    example: 10,
    description: '希望使用的纯利豆数量（可选，默认 0），1 豆 = 1 元',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '纯利豆数量必须是整数' })
  @Min(0, { message: '纯利豆数量不能小于 0' })
  useBeans?: number;
}
