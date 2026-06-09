import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import {
  SALES_PAYMENT_METHOD_VALUES,
  type SalesPaymentMethodValue,
} from '../../sales-record/sales-record.types';
import {
  SPACE_BILLING_MODE_VALUES,
  SPACE_SESSION_STATUS_VALUES,
  type SpaceBillingModeValue,
  type SpaceSessionStatusValue,
} from '../spaces.constants';
import {
  SPACE_CUSTOMER_PAYMENT_METHOD_VALUES,
  SPACE_SETTLEMENT_CHANNEL_VALUES,
  type SpaceCustomerPaymentMethodValue,
  type SpaceSettlementChannelValue,
} from './space-session.constants';

export class SpaceSessionItemResponseDto {
  @ApiProperty({ example: 'SYS_TIME_BILLING', description: '商品 ID' })
  productId: string;

  @ApiProperty({ example: '台位费（固定）', description: '商品名称' })
  productName: string;

  @ApiProperty({ example: '场地费', description: '商品分类' })
  categoryName: string;

  @ApiProperty({ example: 68, description: '销售单价（元）' })
  salePrice: number;

  @ApiProperty({ example: 68, description: '单件利润（元）' })
  profit: number;

  @ApiProperty({ example: 1, description: '数量' })
  quantity: number;
}

export class SpaceSessionRenewRecordResponseDto {
  @ApiProperty({ example: '1', description: '续费记录 ID' })
  id: string;

  @ApiProperty({ example: 30, description: '续费金额（元）' })
  amount: number;

  @ApiProperty({ example: 26, description: '换算追加分钟数' })
  addedMinutes: number;

  @ApiProperty({
    example: 'wechat',
    description: '支付方式',
    enum: SALES_PAYMENT_METHOD_VALUES,
  })
  paymentMethod: SalesPaymentMethodValue;

  @ApiPropertyOptional({ example: 'MT123456', description: '团购券码' })
  grouponCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '团购平台' })
  grouponPlatform?: string;

  @ApiPropertyOptional({ example: '补差价', description: '备注' })
  note?: string;

  @ApiProperty({ example: 1715695200000, description: '续费时间戳（毫秒）' })
  renewedAt: number;
}

export class SpaceSessionResponseDto {
  @ApiProperty({ example: '1', description: '会话 ID' })
  id: string;

  @ApiProperty({ example: '1', description: '空间 ID' })
  spaceId: string;

  @ApiProperty({ example: 'A台', description: '空间名称快照' })
  spaceName: string;

  @ApiProperty({ example: '台球台', description: '空间类型快照' })
  spaceType: string;

  @ApiPropertyOptional({ example: '张先生', description: '顾客姓名' })
  guestName?: string;

  @ApiPropertyOptional({ example: '13800138000', description: '顾客电话' })
  guestPhone?: string;

  @ApiPropertyOptional({ example: 4, description: '顾客人数' })
  guestCount?: number;

  @ApiProperty({ example: 1715691600000, description: '开台时间戳（毫秒）' })
  startTime: number;

  @ApiPropertyOptional({
    example: 1715695200000,
    description: '结账时间戳（毫秒）',
  })
  endTime?: number;

  @ApiProperty({
    example: 'timed',
    description: '计费模式',
    enum: SPACE_BILLING_MODE_VALUES,
  })
  billingMode: SpaceBillingModeValue;

  @ApiPropertyOptional({
    example: 68,
    description: '计时单价/倒计时台位费（元）',
  })
  hourlyRate?: number;

  @ApiPropertyOptional({ example: 136, description: '结账后的时间费用（元）' })
  timeCost?: number;

  @ApiPropertyOptional({ example: 60, description: '倒计时总时长（分钟）' })
  countdownMinutes?: number;

  @ApiPropertyOptional({ example: true, description: '倒计时到期是否自动结账' })
  autoCheckout?: boolean;

  @ApiPropertyOptional({
    example: 'cash',
    description: '预付支付方式',
    enum: SALES_PAYMENT_METHOD_VALUES,
  })
  prepaidPaymentMethod?: SalesPaymentMethodValue;

  @ApiPropertyOptional({
    example: 'groupon_voucher',
    description: '预付顾客支付方式',
    enum: SPACE_CUSTOMER_PAYMENT_METHOD_VALUES,
  })
  prepaidCustomerPaymentMethod?: SpaceCustomerPaymentMethodValue;

  @ApiPropertyOptional({
    example: 'meituan_groupon',
    description: '预付结算渠道',
    enum: SPACE_SETTLEMENT_CHANNEL_VALUES,
  })
  prepaidSettlementChannel?: SpaceSettlementChannelValue;

  @ApiPropertyOptional({ example: 'MT123456', description: '预付团购券码' })
  prepaidGrouponCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '预付团购平台' })
  prepaidGrouponPlatform?: string;

  @ApiPropertyOptional({ example: 'MT123456', description: '预付券码' })
  prepaidVoucherCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '预付券所属平台' })
  prepaidVoucherPlatform?: string;

  @ApiPropertyOptional({ example: '美团团购券', description: '预付备注' })
  prepaidNote?: string;

  @ApiPropertyOptional({ example: 88, description: '预付金额（元）' })
  prepaidAmount?: number;

  @ApiPropertyOptional({ example: 88, description: '预付券面金额（元）' })
  prepaidVoucherFaceAmount?: number;

  @ApiProperty({ type: [SpaceSessionItemResponseDto], description: '消费明细' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpaceSessionItemResponseDto)
  items: SpaceSessionItemResponseDto[];

  @ApiProperty({ example: 0, description: '商品费用合计（元）' })
  itemsCost: number;

  @ApiProperty({
    type: [SpaceSessionRenewRecordResponseDto],
    description: '续费记录',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpaceSessionRenewRecordResponseDto)
  renewRecords: SpaceSessionRenewRecordResponseDto[];

  @ApiProperty({
    example: 'active',
    description: '会话状态',
    enum: SPACE_SESSION_STATUS_VALUES,
  })
  status: SpaceSessionStatusValue;

  @ApiPropertyOptional({ example: '123', description: '关联销售订单 ID' })
  orderId?: string;

  @ApiProperty({ example: 1715691600000, description: '创建时间戳（毫秒）' })
  createdAt: number;
}
