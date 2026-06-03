import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SALES_PAYMENT_METHOD_VALUES,
  type SalesPaymentMethodValue,
} from '../../sales-record/sales-record.types';
import {
  SPACE_BILLING_MODE_VALUES,
  type SpaceBillingModeValue,
} from '../spaces.constants';
import {
  SPACE_COUNTDOWN_FEE_MODE_VALUES,
  SPACE_CUSTOMER_PAYMENT_METHOD_VALUES,
  SPACE_SESSION_CONTACT_PATTERN,
  SPACE_SETTLEMENT_CHANNEL_VALUES,
  SPACE_SETTLEMENT_STATUS_VALUES,
  SPACE_TIME_FEE_MODE_VALUES,
  type SpaceCountdownFeeModeValue,
  type SpaceCustomerPaymentMethodValue,
  type SpaceSettlementChannelValue,
  type SpaceSettlementStatusValue,
  type SpaceTimeFeeModeValue,
} from './space-session.constants';

export class OpenSpaceSessionDto {
  @ApiPropertyOptional({ example: 1, description: '空间 ID（兼容根路径开台）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '空间 ID 必须是整数' })
  @Min(1, { message: '空间 ID 必须大于等于 1' })
  spaceId?: number;

  @ApiPropertyOptional({ example: '张先生', description: '顾客姓名' })
  @IsOptional()
  @IsString({ message: '顾客姓名必须是字符串' })
  @MaxLength(20, { message: '顾客姓名最长 20 个字符' })
  guestName?: string;

  @ApiPropertyOptional({ example: '13800138000', description: '顾客电话' })
  @IsOptional()
  @IsString({ message: '顾客电话必须是字符串' })
  @MaxLength(20, { message: '顾客电话最长 20 个字符' })
  @Matches(SPACE_SESSION_CONTACT_PATTERN, {
    message: '顾客电话格式不正确，请输入 6-20 位数字或常见联系电话格式',
  })
  guestPhone?: string;

  @ApiPropertyOptional({ example: 4, description: '顾客人数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '顾客人数必须是整数' })
  @Min(1, { message: '顾客人数必须大于等于 1' })
  @Max(999, { message: '顾客人数必须小于等于 999' })
  guestCount?: number;

  @ApiProperty({
    example: 'items',
    description: '计费模式',
    enum: SPACE_BILLING_MODE_VALUES,
  })
  @IsIn(SPACE_BILLING_MODE_VALUES, { message: '计费模式不合法' })
  billingMode: SpaceBillingModeValue;

  @ApiPropertyOptional({
    example: 68,
    description: '计时单价/倒计时台位费（元）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '计时单价必须是数字' })
  @Min(0.01, { message: '计时单价必须大于 0' })
  hourlyRate?: number;

  @ApiPropertyOptional({ example: 60, description: '倒计时总时长（分钟）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '倒计时时长必须是整数' })
  @Min(1, { message: '倒计时时长必须大于 0' })
  countdownMinutes?: number;

  @ApiPropertyOptional({ example: true, description: '倒计时到期是否自动结账' })
  @IsOptional()
  @IsBoolean({ message: '自动结账标记必须是布尔值' })
  autoCheckout?: boolean;

  @ApiPropertyOptional({
    example: '12',
    description: '从预约转开台时关联的预约 ID',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '预约 ID 必须是整数' })
  @Min(1, { message: '预约 ID 必须大于等于 1' })
  reservationId?: number;

  @ApiPropertyOptional({
    example: 'cash',
    description: '预付支付方式（自动结账时）',
    enum: SALES_PAYMENT_METHOD_VALUES,
  })
  @IsOptional()
  @IsIn(SALES_PAYMENT_METHOD_VALUES, { message: '预付支付方式不合法' })
  prepaidPaymentMethod?: SalesPaymentMethodValue;

  @ApiPropertyOptional({
    example: 'groupon_voucher',
    description: '预付顾客支付方式',
    enum: SPACE_CUSTOMER_PAYMENT_METHOD_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_CUSTOMER_PAYMENT_METHOD_VALUES, {
    message: '预付顾客支付方式不合法',
  })
  prepaidCustomerPaymentMethod?: SpaceCustomerPaymentMethodValue;

  @ApiPropertyOptional({
    example: 'meituan_groupon',
    description: '预付结算渠道',
    enum: SPACE_SETTLEMENT_CHANNEL_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_SETTLEMENT_CHANNEL_VALUES, { message: '预付结算渠道不合法' })
  prepaidSettlementChannel?: SpaceSettlementChannelValue;

  @ApiPropertyOptional({ example: 'MT123456', description: '预付团购券码' })
  @IsOptional()
  @IsString({ message: '预付团购券码必须是字符串' })
  @MaxLength(50, { message: '预付团购券码最长 50 个字符' })
  prepaidGrouponCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '预付团购平台' })
  @IsOptional()
  @IsString({ message: '预付团购平台必须是字符串' })
  @MaxLength(20, { message: '预付团购平台最长 20 个字符' })
  prepaidGrouponPlatform?: string;

  @ApiPropertyOptional({ example: 'MT123456', description: '预付券码' })
  @IsOptional()
  @IsString({ message: '预付券码必须是字符串' })
  @MaxLength(50, { message: '预付券码最长 50 个字符' })
  prepaidVoucherCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '预付券所属平台' })
  @IsOptional()
  @IsString({ message: '预付券所属平台必须是字符串' })
  @MaxLength(20, { message: '预付券所属平台最长 20 个字符' })
  prepaidVoucherPlatform?: string;

  @ApiPropertyOptional({ example: '美团团购券', description: '预付备注' })
  @IsOptional()
  @IsString({ message: '预付备注必须是字符串' })
  @MaxLength(200, { message: '预付备注最长 200 个字符' })
  prepaidNote?: string;

  @ApiPropertyOptional({ example: 88, description: '预付金额（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '预付金额必须是数字' })
  @Min(0.01, { message: '预付金额必须大于 0' })
  prepaidAmount?: number;

  @ApiPropertyOptional({ example: 88, description: '预付券面金额（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '预付券面金额必须是数字' })
  @Min(0.01, { message: '预付券面金额必须大于 0' })
  prepaidVoucherFaceAmount?: number;
}

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

  @ApiPropertyOptional({ example: '美团', description: '团购平台' })
  @IsOptional()
  @IsString({ message: '团购平台必须是字符串' })
  @MaxLength(20, { message: '团购平台最长 20 个字符' })
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

  @ApiPropertyOptional({ example: '美团', description: '券所属平台' })
  @IsOptional()
  @IsString({ message: '券所属平台必须是字符串' })
  @MaxLength(20, { message: '券所属平台最长 20 个字符' })
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

export class SpaceSessionItemDto {
  @ApiProperty({ example: 'prod_1001', description: '商品 ID' })
  @IsString({ message: '商品 ID 必须是字符串' })
  @MaxLength(64, { message: '商品 ID 最长 64 个字符' })
  productId: string;

  @ApiProperty({ example: '可乐', description: '商品名称' })
  @IsString({ message: '商品名称必须是字符串' })
  @MaxLength(100, { message: '商品名称最长 100 个字符' })
  productName: string;

  @ApiProperty({ example: '饮品', description: '商品分类' })
  @IsString({ message: '商品分类必须是字符串' })
  @MaxLength(100, { message: '商品分类最长 100 个字符' })
  categoryName: string;

  @ApiProperty({ example: 12, description: '销售单价（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '销售单价必须是数字' })
  @Min(0, { message: '销售单价不能小于 0' })
  salePrice: number;

  @ApiProperty({ example: 6, description: '单件利润（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '单件利润必须是数字' })
  profit: number;

  @ApiProperty({ example: 2, description: '数量' })
  @Type(() => Number)
  @IsInt({ message: '数量必须是整数' })
  @Min(1, { message: '数量必须大于等于 1' })
  quantity: number;
}

export class AddSpaceSessionItemsDto {
  @ApiProperty({
    type: [SpaceSessionItemDto],
    description: '本次追加的商品明细',
  })
  @IsArray({ message: '商品明细必须是数组' })
  @ArrayMinSize(1, { message: '请至少选择一件商品' })
  @ValidateNested({ each: true })
  @Type(() => SpaceSessionItemDto)
  items: SpaceSessionItemDto[];
}

export class RenewSpaceSessionDto {
  @ApiProperty({ example: 30, description: '续费金额（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '续费金额必须是数字' })
  @Min(0.01, { message: '续费金额必须大于 0' })
  amount: number;

  @ApiProperty({
    example: 'wechat',
    description: '支付方式',
    enum: SALES_PAYMENT_METHOD_VALUES,
  })
  @IsIn(SALES_PAYMENT_METHOD_VALUES, { message: '支付方式不合法' })
  paymentMethod: SalesPaymentMethodValue;

  @ApiPropertyOptional({ example: 'MT123456', description: '团购券码' })
  @IsOptional()
  @IsString({ message: '团购券码必须是字符串' })
  @MaxLength(50, { message: '团购券码最长 50 个字符' })
  grouponCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '团购平台' })
  @IsOptional()
  @IsString({ message: '团购平台必须是字符串' })
  @MaxLength(50, { message: '团购平台最长 50 个字符' })
  grouponPlatform?: string;

  @ApiPropertyOptional({ example: '补差价', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;
}

export class TransferSpaceSessionDto {
  @ApiProperty({ example: 2, description: '目标空间 ID' })
  @Type(() => Number)
  @IsInt({ message: '目标空间 ID 必须是整数' })
  @Min(1, { message: '目标空间 ID 必须大于等于 1' })
  targetSpaceId: number;
}
