// ─── 短信钱包 · 概览 / 充值 / 流水 DTO ─────────────────────────────────────

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MarketingPaginationMetaDto } from '../../dto/marketing-pagination-meta.dto';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import {
  SMS_RECHARGE_ORDER_STATUS_VALUES,
  SMS_WALLET_LOG_TYPE_VALUES,
  type SmsRechargeOrderStatusValue,
  type SmsWalletLogTypeValue,
} from '../sms.constants';

export class CreateSmsRechargeOrderDto {
  /**
   * 只作为「用户选了哪一档」的标识，**不是**权威金额。
   *
   * Service 会把它与后端下发的充值档位逐一比对，不在档位内直接 400，
   * 因此客户端无法构造任意金额下单。
   */
  @ApiProperty({
    example: 1000,
    description:
      '充值金额（分）。必须是 GET /marketing/sms/recharge-tiers 下发的档位金额，否则 400',
  })
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

export class SmsAccountResponseDto {
  @ApiProperty({ example: 12800, description: '短信钱包可用余额（分）' })
  balanceFen!: number;

  @ApiProperty({ example: 5, description: '短信单价（分/条）' })
  unitPriceFen!: number;
}

export class SmsRechargeOrderResponseDto {
  @ApiProperty({ example: 'SM202610152030001234AB', description: '充值订单号' })
  orderNo!: string;

  /**
   * 下单后的**权威状态**。
   *
   * 测试模式（全局支付模式为 test 且非生产）下单即入账，这里直接是 `paid`。
   * 前端必须按该字段决定走「已到账」还是「出示二维码」，
   * 不能靠 `qrCodeImageUrl` 是否为空去猜模式——那会把已到账显示成支付失败。
   */
  @ApiProperty({
    enum: SMS_RECHARGE_ORDER_STATUS_VALUES,
    example: 'pending',
    description: '下单结果状态：pending=待扫码支付 paid=已直接入账（测试模式）',
  })
  status!: SmsRechargeOrderStatusValue;

  @ApiProperty({
    example: 'weixin://wxpay/bizpayurl?pr=abcdefg',
    description:
      '微信 Native 支付二维码链接（weixin:// 协议串，不可直接当图片展示）',
  })
  codeUrl!: string;

  /**
   * 由 codeUrl 渲染出的 PNG data URL，前端可直接 <img src> 展示。
   *
   * 后端出图而不是前端渲染：weixin:// 无法被 <img> 加载（会是一张空白二维码），
   * 而改由前端请求第三方在线生成服务等于把支付链接明文外泄。
   * 本地直充（跳过微信）时为空串。
   */
  @ApiPropertyOptional({
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...',
    description: '支付二维码图片（PNG data URL；本地直充时为空串）',
  })
  qrCodeImageUrl?: string;

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
    type: MarketingPaginationMetaDto,
    example: { page: 1, pageSize: 20, total: 42, totalPages: 3 },
    description: '分页信息',
  })
  meta!: MarketingPaginationMetaDto;
}
