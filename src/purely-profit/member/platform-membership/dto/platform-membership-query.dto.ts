import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const PLATFORM_MEMBERSHIP_PLAN_IDS = [
  'monthly',
  'quarterly',
  'yearly',
  'lifetime',
] as const;

export const PLATFORM_PARTNER_PAYMENT_METHODS = [
  'wechat',
  'alipay',
  'bank',
] as const;

export const PLATFORM_PARTNER_INTENTIONS = [
  'agent',
  'invest',
  'resource',
  'other',
] as const;

export type PlatformMembershipPlanId =
  (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];
export type PlatformPartnerPaymentMethod =
  (typeof PLATFORM_PARTNER_PAYMENT_METHODS)[number];
export type PlatformPartnerIntention =
  (typeof PLATFORM_PARTNER_INTENTIONS)[number];

function transformTrimmedString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim();
}

export class PurchasePlatformMembershipOrderDto {
  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '会员套餐周期，和前端 PlanCycle 保持一致',
  })
  @IsEnum(PLATFORM_MEMBERSHIP_PLAN_IDS, {
    message: '套餐周期不合法',
  })
  planId: PlatformMembershipPlanId;

  @ApiPropertyOptional({
    example: 1200,
    description: '本次希望使用的积分数量，按前端传递的积分数处理',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '积分数量必须是整数' })
  @Min(0, { message: '积分数量不能小于 0' })
  usePoints?: number;

  @ApiPropertyOptional({
    example: 10,
    description: '本次希望使用的纯利豆数量，1 豆 = 1 元',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '纯利豆数量必须是整数' })
  @Min(0, { message: '纯利豆数量不能小于 0' })
  useBeans?: number;
}

export class PreviewPlatformMembershipOrderDto {
  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '会员套餐周期，和前端 PlanCycle 保持一致',
  })
  @IsEnum(PLATFORM_MEMBERSHIP_PLAN_IDS, {
    message: '套餐周期不合法',
  })
  planId: PlatformMembershipPlanId;

  @ApiPropertyOptional({
    example: 1200,
    description: '本次希望使用的积分数量，按前端传递的积分数处理',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '积分数量必须是整数' })
  @Min(0, { message: '积分数量不能小于 0' })
  usePoints?: number;

  @ApiPropertyOptional({
    example: 10,
    description: '本次希望使用的纯利豆数量，1 豆 = 1 元',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '纯利豆数量必须是整数' })
  @Min(0, { message: '纯利豆数量不能小于 0' })
  useBeans?: number;
}

export class ApplyPlatformPartnerDto {
  @ApiProperty({ example: '张三', description: '申请人姓名' })
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString({ message: '申请人姓名必须是字符串' })
  @MaxLength(32, { message: '申请人姓名最多 32 位' })
  name: string;

  @ApiProperty({ example: '13800138000', description: '联系电话' })
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString({ message: '联系电话必须是字符串' })
  @MaxLength(20, { message: '联系电话最多 20 位' })
  phone: string;

  @ApiProperty({ example: '44030119900101123X', description: '身份证号' })
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString({ message: '身份证号必须是字符串' })
  @MaxLength(24, { message: '身份证号最多 24 位' })
  idCard: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['广东省', '深圳市', '南山区'],
    description: '所在地区级联值',
  })
  @IsOptional()
  @IsArray({ message: '所在地区必须是数组' })
  @ArrayMaxSize(8, { message: '所在地区层级不能超过 8 个' })
  @IsString({ each: true, message: '所在地区值必须是字符串' })
  @MaxLength(32, { each: true, message: '所在地区值最多 32 位' })
  region?: string[];

  @ApiProperty({
    enum: PLATFORM_PARTNER_PAYMENT_METHODS,
    example: 'wechat',
    description: '打款方式，和前端 PaymentMethod 保持一致',
  })
  @IsIn(PLATFORM_PARTNER_PAYMENT_METHODS, { message: '打款方式不合法' })
  paymentMethod: PlatformPartnerPaymentMethod;

  @ApiProperty({ example: 'wx_test_001', description: '打款账号' })
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString({ message: '打款账号必须是字符串' })
  @MaxLength(64, { message: '打款账号最多 64 位' })
  paymentAccount: string;

  @ApiProperty({
    enum: PLATFORM_PARTNER_INTENTIONS,
    example: 'resource',
    description: '合作意向，和前端 PartnerIntention 保持一致',
  })
  @IsIn(PLATFORM_PARTNER_INTENTIONS, { message: '合作意向不合法' })
  intention: PlatformPartnerIntention;

  @ApiPropertyOptional({
    example: '有行业资源，希望一起合作推广',
    description: '申请理由 / 自我介绍',
  })
  @IsOptional()
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString({ message: '申请理由必须是字符串' })
  @MaxLength(500, { message: '申请理由最多 500 位' })
  applyReason?: string;
}

export class RejectPlatformPartnerApplicationDto {
  @ApiProperty({
    example: '资料暂不完整，请补充地区和收款账号信息后重新提交',
    description: '驳回原因，会同步写入跟进备注',
  })
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString({ message: '驳回原因必须是字符串' })
  @MaxLength(500, { message: '驳回原因最多 500 位' })
  reason: string;
}

export class CreatePlatformPartnerFollowUpNoteDto {
  @ApiProperty({
    example: '已电话沟通，待补充身份证正反面照片',
    description: '跟进备注内容',
  })
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString({ message: '备注内容必须是字符串' })
  @MaxLength(500, { message: '备注内容最多 500 位' })
  content: string;
}
