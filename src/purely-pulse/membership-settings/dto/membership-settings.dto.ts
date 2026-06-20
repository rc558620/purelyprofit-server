import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export const MEMBERSHIP_SETTING_PLAN_IDS = [
  'monthly',
  'quarterly',
  'yearly',
  'lifetime',
] as const;

export type MembershipSettingPlanId =
  (typeof MEMBERSHIP_SETTING_PLAN_IDS)[number];

export class UpdateMembershipPriceDto {
  @ApiProperty({
    example: 3800,
    description: '套餐价格，单位分',
  })
  @Type(() => Number)
  @IsInt({ message: '套餐价格必须是整数' })
  @Min(0, { message: '套餐价格不能小于 0' })
  price: number;
}

export class UpdateMonthlyMembershipSettingDto extends UpdateMembershipPriceDto {}

export class UpdateQuarterlyMembershipSettingDto extends UpdateMembershipPriceDto {}

export class UpdateYearlyMembershipSettingDto extends UpdateMembershipPriceDto {}

export class UpdateLifetimeMembershipSettingDto extends UpdateMembershipPriceDto {
  @ApiProperty({
    example: 730,
    description: '永久会员有效期天数，单位天',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '永久会员有效期必须是整数' })
  @Min(1, { message: '永久会员有效期必须大于 0' })
  validDays?: number;
}

export class MembershipPlanSettingItemDto {
  @ApiProperty({
    enum: MEMBERSHIP_SETTING_PLAN_IDS,
    description: '套餐标识',
  })
  planId: MembershipSettingPlanId;

  @ApiProperty({
    example: '月度会员',
    description: '套餐名称',
  })
  planName: string;

  @ApiProperty({
    example: 3800,
    description: '套餐价格，单位分',
  })
  price: number;

  @ApiProperty({
    example: 30,
    description: '套餐有效天数，非永久会员时为空',
    nullable: true,
  })
  validDays: number | null;

  @ApiProperty({
    example: 1773556800000,
    description: '最近更新时间戳（ms）',
  })
  updatedAt: number;
}

export class MembershipSettingsResponseDto {
  @ApiProperty({
    type: [MembershipPlanSettingItemDto],
    description: '当前会员套餐配置列表',
  })
  items: MembershipPlanSettingItemDto[];
}
