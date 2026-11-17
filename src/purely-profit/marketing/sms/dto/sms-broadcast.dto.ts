// ─── 群发短信 · 提交 / 任务列表 / 收件人明细 DTO ────────────────────────────

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { MarketingPaginationMetaDto } from '../../dto/marketing-pagination-meta.dto';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import {
  SMS_BROADCAST_MAX_PAGE_SIZE,
  SMS_BROADCAST_STATUS_VALUES,
  SMS_CONTENT_MAX_LENGTH,
  SMS_CUSTOMER_IDS_MESSAGE,
  SMS_MAX_RECIPIENTS_PER_BROADCAST,
  SMS_RECIPIENT_STATUS_VALUES,
  type SmsBroadcastStatusValue,
  type SmsRecipientStatusValue,
} from '../sms.constants';

export class CreateSmsBroadcastDto {
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

  @ApiProperty({
    example: 'qt_9f2c1a7b3d5e7f90a1',
    description: '询价单 ID，由 /marketing/sms/quote 返回',
  })
  @IsString({ message: '询价单 ID 必须是字符串' })
  @Length(1, 64, { message: '询价单 ID 非法' })
  quoteId!: string;

  @ApiProperty({
    example: 'idem_7c1f2e9a4b6d8031',
    description:
      '幂等键。前端跨页续发（钱包页支付成功后回跳群发页）复用同一个 key，后端保证只发一次',
  })
  @IsString({ message: '幂等键必须是字符串' })
  @Length(1, 128, { message: '幂等键长度不能超过 128' })
  idempotencyKey!: string;
}

export class SmsBroadcastResponseDto {
  @ApiProperty({
    example: 'bc_1a2b3c4d5e6f7081',
    description: '群发任务业务 ID',
  })
  broadcastId!: string;

  @ApiProperty({ example: 20, description: '收件人数' })
  recipientCount!: number;

  @ApiProperty({ example: 90, description: '实际扣费金额（分）' })
  chargedAmountFen!: number;
}

export class SmsBroadcastListQueryDto {
  @ApiPropertyOptional({ example: 1, description: '页码，从 1 开始' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于等于 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: '每页数量' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '每页数量必须是整数' })
  @Min(1, { message: '每页数量必须大于等于 1' })
  @Max(SMS_BROADCAST_MAX_PAGE_SIZE, {
    message: `每页数量不能超过 ${SMS_BROADCAST_MAX_PAGE_SIZE}`,
  })
  pageSize?: number;

  @ApiPropertyOptional({
    enum: SMS_BROADCAST_STATUS_VALUES,
    example: 'failed',
    description: '按任务状态筛选，不传为全部',
  })
  @IsOptional()
  @IsIn(SMS_BROADCAST_STATUS_VALUES, { message: '任务状态筛选值非法' })
  status?: SmsBroadcastStatusValue;
}

export class SmsBroadcastRecipientsQueryDto {
  @ApiPropertyOptional({ example: 1, description: '页码，从 1 开始' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于等于 1' })
  page?: number;

  @ApiPropertyOptional({ example: 50, description: '每页数量' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '每页数量必须是整数' })
  @Min(1, { message: '每页数量必须大于等于 1' })
  @Max(SMS_BROADCAST_MAX_PAGE_SIZE, {
    message: `每页数量不能超过 ${SMS_BROADCAST_MAX_PAGE_SIZE}`,
  })
  pageSize?: number;

  @ApiPropertyOptional({
    enum: SMS_RECIPIENT_STATUS_VALUES,
    example: 'failed',
    description: '按投递结果筛选：pending / success / failed',
  })
  @IsOptional()
  @IsIn(SMS_RECIPIENT_STATUS_VALUES, {
    message: '投递结果筛选值非法',
  })
  status?: SmsRecipientStatusValue;
}

export class SmsBroadcastTaskItemDto {
  @ApiProperty({
    example: 'bc_1a2b3c4d5e6f7081',
    description: '群发任务业务 ID',
  })
  broadcastId!: string;

  @ApiProperty({ example: '老顾客回馈：本周到店消费满 100 减 20。' })
  content!: string;

  @ApiProperty({
    enum: SMS_BROADCAST_STATUS_VALUES,
    example: 'partial_failed',
    description:
      'pending=未开始 sending=发送中 sent=全部成功 partial_failed=部分失败 failed=全部失败',
  })
  status!: SmsBroadcastStatusValue;

  @ApiProperty({ example: 20, description: '收件人数（含无手机号者）' })
  recipientCount!: number;

  @ApiProperty({ example: 18, description: '有效手机号人数' })
  validMobileCount!: number;

  @ApiProperty({ example: 18, description: '计费条数' })
  smsSegments!: number;

  @ApiProperty({ example: 16, description: '通道返回成功的收件人数' })
  successCount!: number;

  @ApiProperty({ example: 2, description: '发送失败的收件人数' })
  failedCount!: number;

  @ApiProperty({ example: 90, description: '扣费金额（分）' })
  chargedAmountFen!: number;

  @ApiProperty({ example: 10, description: '已退费金额（分）' })
  refundedAmountFen!: number;

  @ApiProperty({
    example: '2026-10-15T12:30:00.000Z',
    description: '创建时间（ISO 字符串）',
  })
  createdAt!: string;
}

export class SmsBroadcastTaskListResponseDto {
  @ApiProperty({ type: [SmsBroadcastTaskItemDto], description: '群发任务列表' })
  items!: SmsBroadcastTaskItemDto[];

  @ApiProperty({
    type: MarketingPaginationMetaDto,
    example: { page: 1, pageSize: 20, total: 42, totalPages: 3 },
    description: '分页信息',
  })
  meta!: MarketingPaginationMetaDto;
}

export class SmsBroadcastRecipientItemDto {
  @ApiProperty({ example: 1, description: '明细 ID' })
  id!: number;

  @ApiPropertyOptional({
    example: 12,
    description: '顾客 ID（顾客已删除时为空）',
  })
  customerId!: number | null;

  @ApiProperty({ example: '138****0001', description: '收件手机号（脱敏）' })
  phone!: string;

  @ApiProperty({
    example: 'failed',
    description: '投递结果：pending=待发送 success=成功 failed=失败',
  })
  status!: string;

  @ApiPropertyOptional({
    example: 'LimitExceeded.PhoneNumberCountLimit',
    description: '通道返回码',
  })
  providerCode!: string | null;

  @ApiPropertyOptional({
    example: '号码数量超过限制',
    description: '通道返回描述',
  })
  providerMessage!: string | null;
}

export class SmsBroadcastRecipientsResponseDto {
  @ApiProperty({
    type: [SmsBroadcastRecipientItemDto],
    description: '收件人明细',
  })
  items!: SmsBroadcastRecipientItemDto[];

  @ApiProperty({
    type: MarketingPaginationMetaDto,
    example: { page: 1, pageSize: 50, total: 18, totalPages: 1 },
    description: '分页信息',
  })
  meta!: MarketingPaginationMetaDto;
}

export class SmsBroadcastTaskDetailDto {
  @ApiProperty({ type: SmsBroadcastTaskItemDto, description: '任务概要' })
  task!: SmsBroadcastTaskItemDto;

  @ApiProperty({
    type: SmsBroadcastRecipientsResponseDto,
    description: '收件人投递明细（首页）',
  })
  recipients!: SmsBroadcastRecipientsResponseDto;
}
