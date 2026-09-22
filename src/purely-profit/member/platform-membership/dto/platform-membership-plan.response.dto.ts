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
  monthlyPrice?: number | null;

  @ApiPropertyOptional({
    example: true,
    description:
      '是否命中「首购锁定价」：已开通子账号功能的门店按首次成交价续费',
  })
  @IsOptional()
  @IsBoolean({ message: '锁价标记必须是布尔值' })
  lockedPrice?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: '是否隐藏划线原价（永久会员无原价配置）',
  })
  @IsOptional()
  @IsBoolean({ message: '隐藏原价标记必须是布尔值' })
  hideOriginalPrice?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: '是否隐藏月均价（永久会员无时长配置）',
  })
  @IsOptional()
  @IsBoolean({ message: '隐藏月均标记必须是布尔值' })
  hideMonthlyPrice?: boolean;

  @ApiPropertyOptional({
    example: 5,
    description:
      '本档位包含的子账号数量；门店已开通子账号功能时下发，前端在该展示位渲染「包含 x 个子账号」替代划线原价',
  })
  @IsOptional()
  @IsInt({ message: '子账号数量必须是整数' })
  subAccountIncludedCount?: number;
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
