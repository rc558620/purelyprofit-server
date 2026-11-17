// ─── 群发短信 · 询价（报价）DTO ─────────────────────────────────────────────

import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  Length,
} from 'class-validator';
import {
  SMS_CONTENT_MAX_LENGTH,
  SMS_CUSTOMER_IDS_MESSAGE,
  SMS_MAX_RECIPIENTS_PER_BROADCAST,
} from '../sms.constants';

export class CreateSmsQuoteDto {
  @ApiProperty({
    example: ['12', '35', '88'],
    description: '收件顾客 ID 列表（字符串数组，后端转 Int）',
  })
  @IsArray({ message: SMS_CUSTOMER_IDS_MESSAGE })
  @ArrayNotEmpty({ message: '请至少选择一位收件人' })
  @ArrayMaxSize(SMS_MAX_RECIPIENTS_PER_BROADCAST, {
    message: `单次群发最多 ${SMS_MAX_RECIPIENTS_PER_BROADCAST} 位收件人`,
  })
  @IsString({ each: true, message: SMS_CUSTOMER_IDS_MESSAGE })
  customerIds!: string[];

  @ApiProperty({
    example: '老顾客回馈：本周到店消费满 100 减 20，期待您的光临。',
    description: '短信正文',
  })
  @IsString({ message: '短信正文必须是字符串' })
  @Length(1, SMS_CONTENT_MAX_LENGTH, {
    message: `短信正文长度必须在 1 到 ${SMS_CONTENT_MAX_LENGTH} 个字之间`,
  })
  content!: string;
}

export class SmsQuoteResponseDto {
  @ApiProperty({
    example: 'qt_9f2c1a7b3d5e7f90a1',
    description: '询价单 ID，提交群发时回传',
  })
  quoteId!: string;

  @ApiProperty({ example: 20, description: '收件人数（含无手机号者）' })
  recipientCount!: number;

  @ApiProperty({ example: 18, description: '有效手机号人数' })
  validMobileCount!: number;

  @ApiProperty({
    example: 18,
    description: '计费总条数 = 每人分段数 × 有效收件人数（不是每人分段数）',
  })
  smsSegments!: number;

  @ApiProperty({ example: 5, description: '单价（分/条）' })
  unitPriceFen!: number;

  @ApiProperty({ example: 90, description: '预计扣费金额（分）' })
  estimatedAmountFen!: number;

  @ApiProperty({ example: 12800, description: '当前余额（分）' })
  balanceFen!: number;

  @ApiProperty({ example: true, description: '余额是否足够支付本次群发' })
  sufficient!: boolean;

  @ApiProperty({
    example: 0,
    description: '余额不足时的缺口（分），足够时为 0',
  })
  shortageFen!: number;

  @ApiProperty({
    example: '2026-10-15T12:30:00.000Z',
    description: '报价过期时间（ISO 字符串）',
  })
  expiresAt!: string;
}
