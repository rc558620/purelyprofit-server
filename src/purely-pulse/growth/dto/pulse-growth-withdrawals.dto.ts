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
import { WITHDRAWAL_ACCOUNT_TYPE_VALUES } from '../../../purely-profit/member/withdrawals/dto/apply-withdrawal.dto';
import type { WithdrawalAccountTypeValue } from '../../../purely-profit/member/withdrawals/dto/apply-withdrawal.dto';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export const PULSE_WITHDRAWAL_MIN_BEANS = 100;
export const PULSE_WITHDRAWAL_MAX_BEANS = 10000;

export class UpdatePulseWithdrawalAccountDto {
  @ApiProperty({
    enum: WITHDRAWAL_ACCOUNT_TYPE_VALUES,
    example: 'alipay',
    description: '收款账户类型',
  })
  @IsIn(WITHDRAWAL_ACCOUNT_TYPE_VALUES, { message: '收款方式不合法' })
  accountType: WithdrawalAccountTypeValue;

  @ApiProperty({ example: '13800138000', description: '收款账号' })
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '收款账号必须是字符串' })
  @MaxLength(64, { message: '收款账号最多 64 位' })
  accountNo: string;

  @ApiProperty({ example: '张三', description: '收款人真实姓名' })
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '真实姓名必须是字符串' })
  @MaxLength(32, { message: '真实姓名最多 32 位' })
  accountName: string;
}

export class PulseApplyWithdrawalDto {
  @ApiPropertyOptional({
    example: '12',
    description: '指定提现的正式合伙人 ID；不传时默认按主合伙人处理',
  })
  @IsOptional()
  @IsString({ message: '合伙人 ID 必须是字符串' })
  partnerId?: string;

  @ApiProperty({
    example: 100,
    description: '提现纯利豆数量（整数豆）',
  })
  @IsInt({ message: '提现数量必须是整数' })
  @Min(PULSE_WITHDRAWAL_MIN_BEANS, {
    message: `最低提现 ${PULSE_WITHDRAWAL_MIN_BEANS} 豆`,
  })
  @Max(PULSE_WITHDRAWAL_MAX_BEANS, {
    message: `单次最多提现 ${PULSE_WITHDRAWAL_MAX_BEANS} 豆`,
  })
  beanAmount: number;
}
