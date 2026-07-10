import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SALES_PAYMENT_METHOD_VALUES,
  type SalesPaymentMethodValue,
} from '../../sales-record/sales-record.types';
import {
  GROUPON_PLATFORM_VALUES,
  SPACE_COUNTDOWN_FEE_MODE_VALUES,
  SPACE_CUSTOMER_PAYMENT_METHOD_VALUES,
  SPACE_SETTLEMENT_CHANNEL_VALUES,
  SPACE_SETTLEMENT_STATUS_VALUES,
  SPACE_TIME_FEE_MODE_VALUES,
  type SpaceCountdownFeeModeValue,
  type SpaceCustomerPaymentMethodValue,
  type SpaceSettlementChannelValue,
  type SpaceSettlementStatusValue,
  type SpaceTimeFeeModeValue,
} from './space-session.constants';

export class CheckoutSpaceSessionPreviewDto {
  @ApiPropertyOptional({
    example: 'unit_price',
    description: '通用台位费口径：timed=按实际计时，unit_price=按单价',
    enum: SPACE_TIME_FEE_MODE_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_TIME_FEE_MODE_VALUES, { message: '台位费口径不合法' })
  timeFeeMode?: SpaceTimeFeeModeValue;

  @ApiPropertyOptional({
    example: 'fixed',
    description: '倒计时模式的台位费口径',
    enum: SPACE_COUNTDOWN_FEE_MODE_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_COUNTDOWN_FEE_MODE_VALUES, { message: '倒计时结账口径不合法' })
  countdownFeeMode?: SpaceCountdownFeeModeValue;
}

export class CheckoutSpaceSessionDto {
  @ApiProperty({
    example: 'cash',
    description: '结账支付方式',
    enum: SALES_PAYMENT_METHOD_VALUES,
  })
  @IsIn(SALES_PAYMENT_METHOD_VALUES, { message: '结账支付方式不合法' })
  paymentMethod: SalesPaymentMethodValue;

  @ApiPropertyOptional({ example: '客户使用优惠券', description: '结账备注' })
  @IsOptional()
  @IsString({ message: '结账备注必须是字符串' })
  @MaxLength(200, { message: '结账备注最长 200 个字符' })
  note?: string;

  @ApiPropertyOptional({ example: 'MT123456', description: '团购券码' })
  @IsOptional()
  @IsString({ message: '团购券码必须是字符串' })
  @MaxLength(50, { message: '团购券码最长 50 个字符' })
  grouponCode?: string;

  @ApiPropertyOptional({
    example: 'meituan',
    description: '团购平台',
    enum: GROUPON_PLATFORM_VALUES,
  })
  @IsOptional()
  @IsIn(GROUPON_PLATFORM_VALUES, { message: '团购平台不合法' })
  grouponPlatform?: string;

  @ApiPropertyOptional({
    example: 'groupon_voucher',
    description: '顾客实际支付方式',
    enum: SPACE_CUSTOMER_PAYMENT_METHOD_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_CUSTOMER_PAYMENT_METHOD_VALUES, {
    message: '顾客支付方式不合法',
  })
  customerPaymentMethod?: SpaceCustomerPaymentMethodValue;

  @ApiPropertyOptional({
    example: 'meituan_groupon',
    description: '平台结算渠道',
    enum: SPACE_SETTLEMENT_CHANNEL_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_SETTLEMENT_CHANNEL_VALUES, { message: '结算渠道不合法' })
  settlementChannel?: SpaceSettlementChannelValue;

  @ApiPropertyOptional({ example: 'MT123456', description: '券码' })
  @IsOptional()
  @IsString({ message: '券码必须是字符串' })
  @MaxLength(50, { message: '券码最长 50 个字符' })
  voucherCode?: string;

  @ApiPropertyOptional({
    example: 'meituan',
    description: '券所属平台',
    enum: GROUPON_PLATFORM_VALUES,
  })
  @IsOptional()
  @IsIn(GROUPON_PLATFORM_VALUES, { message: '券所属平台不合法' })
  voucherPlatform?: string;

  @ApiPropertyOptional({ example: 88, description: '券面金额（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '券面金额必须是数字' })
  @Min(0.01, { message: '券面金额必须大于 0' })
  voucherFaceAmount?: number;

  @ApiPropertyOptional({
    example: 'pending',
    description: '平台结算状态',
    enum: SPACE_SETTLEMENT_STATUS_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_SETTLEMENT_STATUS_VALUES, { message: '平台结算状态不合法' })
  settlementStatus?: SpaceSettlementStatusValue;

  @ApiPropertyOptional({ example: 80, description: '平台应收金额（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '平台应收金额必须是数字' })
  @Min(0, { message: '平台应收金额不能为负数' })
  platformReceivable?: number;

  @ApiPropertyOptional({ example: 0, description: '平台已结金额（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '平台已结金额必须是数字' })
  @Min(0, { message: '平台已结金额不能为负数' })
  platformSettledAmount?: number;

  @ApiPropertyOptional({ example: 8, description: '平台手续费（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '平台手续费必须是数字' })
  @Min(0, { message: '平台手续费不能为负数' })
  platformFee?: number;

  @ApiPropertyOptional({
    example: 'unit_price',
    description: '通用台位费口径：timed=按实际计时，unit_price=按单价',
    enum: SPACE_TIME_FEE_MODE_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_TIME_FEE_MODE_VALUES, { message: '台位费口径不合法' })
  timeFeeMode?: SpaceTimeFeeModeValue;

  @ApiPropertyOptional({
    example: 'fixed',
    description: '倒计时模式的台位费口径',
    enum: SPACE_COUNTDOWN_FEE_MODE_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_COUNTDOWN_FEE_MODE_VALUES, { message: '倒计时结账口径不合法' })
  countdownFeeMode?: SpaceCountdownFeeModeValue;

  @ApiProperty({
    example: 'space_lock_xxx',
    description: '结账预览返回的锁单 ID',
  })
  @IsString({ message: '锁单 ID 必须是字符串' })
  @MaxLength(80, { message: '锁单 ID 最长 80 个字符' })
  lockId: string;

  @ApiProperty({
    example: 1715695200000,
    description: '锁单时间戳（毫秒）',
  })
  @Type(() => Number)
  @IsInt({ message: '锁单时间必须是整数时间戳' })
  @Min(0, { message: '锁单时间不合法' })
  lockedAt: number;
}
