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
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import {
  SMS_BROADCAST_MAX_PAGE_SIZE,
  SMS_BROADCAST_STATUS_VALUES,
  SMS_CONTENT_MAX_LENGTH,
  SMS_MAX_RECIPIENTS_PER_BROADCAST,
  SMS_RECHARGE_ORDER_STATUS_VALUES,
  SMS_WALLET_LOG_TYPE_VALUES,
  type SmsBroadcastStatusValue,
  type SmsRechargeOrderStatusValue,
  type SmsWalletLogTypeValue,
} from '../sms.constants';

// ─── 请求 DTO ────────────────────────────────────────────────────────────────

/** 顾客 ID 统一用字符串数组（前端 Map 的 key），后端查询时转 Int。 */
const CUSTOMER_IDS_MESSAGE =
  '收件人 ID 列表必须是非空字符串数组，且不能超过 200 个';

export class CreateSmsQuoteDto {
  @ApiProperty({
    example: ['12', '35', '88'],
    description: '收件顾客 ID 列表（字符串数组，后端转 Int）',
  })
  @IsArray({ message: CUSTOMER_IDS_MESSAGE })
  @ArrayNotEmpty({ message: '请至少选择一位收件人' })
  @ArrayMaxSize(SMS_MAX_RECIPIENTS_PER_BROADCAST, {
    message: `单次群发最多 ${SMS_MAX_RECIPIENTS_PER_BROADCAST} 位收件人`,
  })
  @IsString({ each: true, message: CUSTOMER_IDS_MESSAGE })
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

export class CreateSmsBroadcastDto {
  @ApiProperty({
    example: ['12', '35', '88'],
    description: '收件顾客 ID 列表（字符串数组，后端转 Int）',
  })
  @IsArray({ message: CUSTOMER_IDS_MESSAGE })
  @ArrayNotEmpty({ message: '请至少选择一位收件人' })
  @ArrayMaxSize(SMS_MAX_RECIPIENTS_PER_BROADCAST, {
    message: `单次群发最多 ${SMS_MAX_RECIPIENTS_PER_BROADCAST} 位收件人`,
  })
  @IsString({ each: true, message: CUSTOMER_IDS_MESSAGE })
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

export class CreateSmsRechargeOrderDto {
  @ApiProperty({ example: 1000, description: '充值金额（分），最小 1 分' })
  @IsInt({ message: '充值金额必须是整数（分）' })
  @Min(1, { message: '充值金额必须大于 0' })
  @Max(100_000_000, { message: '单次充值金额过大' })
  amountFen!: number;
}

export class SmsWalletLogsQueryDto {
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
  @Max(200, { message: '每页数量不能超过 200' })
  pageSize?: number;
}

// ─── 响应 DTO ────────────────────────────────────────────────────────────────

export class SmsAccountResponseDto {
  @ApiProperty({ example: 12800, description: '短信钱包可用余额（分）' })
  balanceFen!: number;

  @ApiProperty({ example: 5, description: '短信单价（分/条）' })
  unitPriceFen!: number;
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

export class SmsRechargeOrderResponseDto {
  @ApiProperty({ example: 'SM202610152030001234AB', description: '充值订单号' })
  orderNo!: string;

  @ApiProperty({
    example: 'weixin://wxpay/bizpayurl?pr=abcdefg',
    description: '微信 Native 支付二维码链接',
  })
  codeUrl!: string;

  @ApiProperty({ example: 1000, description: '充值金额（分）' })
  amountFen!: number;

  @ApiProperty({
    example: '2026-10-15T13:00:00.000Z',
    description: '订单过期时间（ISO 字符串），超时未支付自动关闭',
  })
  expiresAt!: string;
}

export class SmsRechargeOrderStatusDto {
  @ApiProperty({ example: 'SM202610152030001234AB', description: '充值订单号' })
  orderNo!: string;

  @ApiProperty({
    enum: SMS_RECHARGE_ORDER_STATUS_VALUES,
    example: 'paid',
    description:
      '订单状态：pending=待支付 paid=已支付 closed=已关闭 failed=失败',
  })
  status!: SmsRechargeOrderStatusValue;
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

/** 收件人投递结果筛选值 */
export const SMS_RECIPIENT_STATUS_FILTER_VALUES = [
  'pending',
  'success',
  'failed',
] as const;

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
    enum: SMS_RECIPIENT_STATUS_FILTER_VALUES,
    example: 'failed',
    description: '按投递结果筛选：pending / success / failed',
  })
  @IsOptional()
  @IsIn(SMS_RECIPIENT_STATUS_FILTER_VALUES, {
    message: '投递结果筛选值非法',
  })
  status?: (typeof SMS_RECIPIENT_STATUS_FILTER_VALUES)[number];
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
    example: { page: 1, pageSize: 20, total: 42, totalPages: 3 },
    description: '分页信息',
  })
  meta!: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
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
    example: { page: 1, pageSize: 50, total: 18, totalPages: 1 },
    description: '分页信息',
  })
  meta!: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
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

export class SmsWalletResponseDto {
  @ApiProperty({ example: 12800, description: '可用余额（分）' })
  balanceFen!: number;

  @ApiProperty({ example: 5, description: '短信单价（分/条）' })
  unitPriceFen!: number;

  @ApiProperty({ example: 500, description: '余额告警阈值（分）' })
  warningThresholdFen!: number;

  @ApiProperty({ example: 20000, description: '累计充值（分，不含赠送）' })
  totalRechargedFen!: number;

  @ApiProperty({ example: 7200, description: '累计消费（分）' })
  totalConsumedFen!: number;

  @ApiProperty({ example: 1440, description: '累计发送成功的短信条数' })
  sentSmsCount!: number;
}

export class SmsRechargeTierDto {
  @ApiProperty({ example: 1000, description: '档位金额（分）' })
  amountFen!: number;

  @ApiProperty({ example: '¥10', description: '档位展示文案，由后端下发' })
  amountDisplay!: string;
}

export class SmsRechargeTiersResponseDto {
  @ApiProperty({
    type: [SmsRechargeTierDto],
    description: '充值档位（不含任何赠送）',
  })
  tiers!: SmsRechargeTierDto[];
}

export class SmsWalletLogItemDto {
  @ApiProperty({ example: 1, description: '流水 ID' })
  id!: number;

  @ApiProperty({
    enum: SMS_WALLET_LOG_TYPE_VALUES,
    example: 'consume',
    description: '流水类型',
  })
  type!: SmsWalletLogTypeValue;

  @ApiProperty({
    example: -90,
    description: '变动金额（分）：正数为入账，负数为出账',
  })
  changeFen!: number;

  @ApiProperty({ example: 12710, description: '变动后余额（分）' })
  balanceAfterFen!: number;

  @ApiProperty({ example: '群发短信扣费', description: '流水说明' })
  description!: string;

  @ApiProperty({
    example: '2026-10-15T12:30:00.000Z',
    description: '发生时间（ISO 字符串，前端按上海时区格式化）',
  })
  createdAt!: string;
}

export class SmsWalletLogsResponseDto {
  @ApiProperty({ type: [SmsWalletLogItemDto], description: '流水列表' })
  items!: SmsWalletLogItemDto[];

  @ApiProperty({
    example: { page: 1, pageSize: 20, total: 42, totalPages: 3 },
    description: '分页信息',
  })
  meta!: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export class SmsWechatCallbackAckDto {
  @ApiProperty({ example: true, description: '是否成功接收并处理回调' })
  success!: boolean;

  @ApiProperty({
    example: 'SM202610152030001234AB',
    description: '业务订单号',
  })
  orderNo!: string;

  @ApiProperty({ example: 'paid', description: '订单处理后状态' })
  status!: string;

  @ApiPropertyOptional({
    example: '订单已入账',
    description: '处理说明（重复回调会返回 already_processed 一类提示）',
  })
  message?: string;
}

// ─── 微信回调报文（复用 club 侧结构，独立定义避免反向依赖 club 模块）─────────

export class SmsWechatCallbackResourceDto {
  @ApiProperty({
    example: 'AEAD_AES_256_GCM',
    description: '加密算法，微信固定为 AEAD_AES_256_GCM',
  })
  @IsString()
  algorithm!: string;

  @ApiProperty({ example: 'BxBoAEWAt...', description: 'Base64 密文' })
  @IsString()
  ciphertext!: string;

  @ApiProperty({ example: 'fdasflkjas', description: '加密随机串（12 字节）' })
  @IsString()
  nonce!: string;

  @ApiPropertyOptional({ example: 'transaction', description: '附加数据' })
  @IsOptional()
  @IsString()
  associated_data?: string;
}

export class SmsWechatCallbackDto {
  @ApiProperty({ example: '5d6bb6c0-f7e3-11ed-a05b-0242ac120003' })
  @IsString()
  id!: string;

  @ApiProperty({ example: '2026-10-15T12:31:00+08:00' })
  @IsString()
  create_time!: string;

  @ApiProperty({ example: 'TRANSACTION.SUCCESS' })
  @IsString()
  event_type!: string;

  @ApiPropertyOptional({ example: 'encrypt-resource' })
  @IsOptional()
  @IsString()
  resource_type?: string;

  @ApiPropertyOptional({ example: '支付成功' })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty({ type: SmsWechatCallbackResourceDto })
  resource!: SmsWechatCallbackResourceDto;
}

/** 短信充值订单号格式：`SM` 前缀 + 时间戳 + 随机 HEX */
export const SMS_ORDER_NO_PATTERN = /^SM\d{17}[0-9A-F]{4}$/;

/**
 * 判定订单号是否属于短信钱包。
 *
 * ⚠️ 回调路由是独立的（不会收到 club 订单），但这里仍做前缀校验：
 * 一旦有人把 `SMS_WECHAT_PAY_NOTIFY_URL` 错配到 club 回调地址上，
 * 会把 RC/SV 订单当成短信充值单入账，属于资金事故级错误。
 */
export function isSmsOrderNo(orderNo: string): boolean {
  return SMS_ORDER_NO_PATTERN.test(orderNo);
}

/** 幂等键允许字符集（后端只做字符校验，避免任意字符串写进唯一索引） */
export const SMS_IDEMPOTENCY_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]+$/;
