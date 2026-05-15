import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const WITHDRAWAL_ACCOUNT_TYPE_VALUES = [
  'wechat',
  'alipay',
  'bank',
] as const;
export const PARTNER_WITHDRAWAL_STATUS_VALUES = [
  'pending',
  'approved',
  'paid',
  'rejected',
] as const;
export const PARTNER_WITHDRAWAL_MIN_BEANS = 500;
export const PARTNER_WITHDRAWAL_MAX_BEANS = 10000;

export type WithdrawalAccountTypeValue =
  (typeof WITHDRAWAL_ACCOUNT_TYPE_VALUES)[number];
export type PartnerWithdrawalStatusValue =
  (typeof PARTNER_WITHDRAWAL_STATUS_VALUES)[number];

function transformTrimmedString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim();
}

export class ApplyWithdrawalDto {
  @ApiProperty({
    example: 500,
    description: '提现纯利豆数量，前端当前按整数豆提交',
  })
  @IsInt({ message: '提现数量必须是整数' })
  @Min(PARTNER_WITHDRAWAL_MIN_BEANS, {
    message: `最低提现 ${PARTNER_WITHDRAWAL_MIN_BEANS} 豆`,
  })
  @Max(PARTNER_WITHDRAWAL_MAX_BEANS, {
    message: `单次最多提现 ${PARTNER_WITHDRAWAL_MAX_BEANS} 豆`,
  })
  beanAmount: number;

  @ApiProperty({
    enum: WITHDRAWAL_ACCOUNT_TYPE_VALUES,
    example: 'alipay',
    description: '收款账户类型',
  })
  @IsIn(WITHDRAWAL_ACCOUNT_TYPE_VALUES, { message: '收款方式不合法' })
  accountType: WithdrawalAccountTypeValue;

  @ApiProperty({
    example: '13800138000',
    description: '收款账号',
  })
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString({ message: '收款账号必须是字符串' })
  @MaxLength(64, { message: '收款账号最多 64 位' })
  accountNo: string;

  @ApiProperty({
    example: '张三',
    description: '收款人真实姓名',
  })
  @Transform(({ value }) => transformTrimmedString(value))
  @IsString({ message: '真实姓名必须是字符串' })
  @MaxLength(32, { message: '真实姓名最多 32 位' })
  accountName: string;
}

export class ListWithdrawalsQueryDto {
  @ApiPropertyOptional({
    enum: PARTNER_WITHDRAWAL_STATUS_VALUES,
    description: '按提现状态筛选，不传时返回全部记录',
  })
  @IsOptional()
  @IsIn(PARTNER_WITHDRAWAL_STATUS_VALUES, { message: '提现状态不合法' })
  status?: PartnerWithdrawalStatusValue;
}
