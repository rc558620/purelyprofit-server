import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SALES_PAYMENT_METHOD_VALUES,
  type SalesPaymentMethodValue,
} from '../../sales-record/sales-record.types';
import {
  GROUPON_PLATFORM_VALUES,
  SPACE_CHECKOUT_SETTLEMENT_KIND_VALUES,
  SPACE_CHECKOUT_SETTLEMENT_TARGET_VALUES,
  SPACE_COUNTDOWN_FEE_MODE_VALUES,
  SPACE_CUSTOMER_PAYMENT_METHOD_VALUES,
  SPACE_SETTLEMENT_CHANNEL_VALUES,
  SPACE_SETTLEMENT_STATUS_VALUES,
  SPACE_TIME_FEE_MODE_VALUES,
  type SpaceCheckoutSettlementKindValue,
  type SpaceCheckoutSettlementTargetValue,
  type SpaceCountdownFeeModeValue,
  type SpaceCustomerPaymentMethodValue,
  type SpaceSettlementChannelValue,
  type SpaceSettlementStatusValue,
  type SpaceTimeFeeModeValue,
} from './space-session.constants';

/**
 * 结账单笔抵扣明细（卡抵台位费 / 券抵商品 / 余额抵应付）。
 *
 * 金额只是「前端预期值」：后端会在事务内用权威结算结果重算每项额度上限，
 * 超出上限一律 400，不做静默截断，避免前端展示的应付与实际核销金额不一致。
 */
export class CheckoutSettlementItemDto {
  @ApiProperty({
    example: 'member_card',
    description: '资产类型：member_card=会员卡 voucher=团购券 balance=储值余额',
    enum: SPACE_CHECKOUT_SETTLEMENT_KIND_VALUES,
  })
  @IsIn(SPACE_CHECKOUT_SETTLEMENT_KIND_VALUES, {
    message: '抵扣资产类型不合法',
  })
  kind: SpaceCheckoutSettlementKindValue;

  @ApiProperty({
    example: 'time_fee',
    description: '作用对象：time_fee=台位费 items=商品 total=应付合计',
    enum: SPACE_CHECKOUT_SETTLEMENT_TARGET_VALUES,
  })
  @IsIn(SPACE_CHECKOUT_SETTLEMENT_TARGET_VALUES, {
    message: '抵扣作用对象不合法',
  })
  target: SpaceCheckoutSettlementTargetValue;

  @ApiPropertyOptional({
    example: '128',
    description:
      '资产标识：会员卡=持卡实例 ID，团购券=券码，余额=会员 customerId',
  })
  @IsOptional()
  @IsString({ message: '抵扣资产标识必须是字符串' })
  @MaxLength(80, { message: '抵扣资产标识最长 80 个字符' })
  assetId?: string;

  @ApiPropertyOptional({
    example: '年卡',
    description: '资产名称快照（展示用）',
  })
  @IsOptional()
  @IsString({ message: '抵扣资产名称必须是字符串' })
  @MaxLength(100, { message: '抵扣资产名称最长 100 个字符' })
  assetLabel?: string;

  @ApiProperty({ example: 32.67, description: '抵扣金额（元，最多两位小数）' })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '抵扣金额必须是数字且最多两位小数' },
  )
  @Min(0.01, { message: '抵扣金额必须大于 0' })
  amount: number;
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

  @ApiPropertyOptional({
    type: [CheckoutSettlementItemDto],
    description:
      '多资产抵扣明细（会员卡抵台位费 / 团购券抵商品 / 储值余额抵应付）；无抵扣时不下发',
  })
  @IsOptional()
  @IsArray({ message: '抵扣明细必须是数组' })
  @ArrayMaxSize(3, { message: '抵扣明细最多 3 条（卡 / 券 / 余额各一条）' })
  @ValidateNested({ each: true })
  @Type(() => CheckoutSettlementItemDto)
  settlements?: CheckoutSettlementItemDto[];

  @ApiPropertyOptional({
    example: 20,
    description:
      '抵扣后的前端预期应付（元）。后端按权威结果重算应收并与之比对，不一致直接拒绝，避免锁单过期期间金额漂移',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '预期应付必须是数字且最多两位小数' },
  )
  @Min(0, { message: '预期应付不能为负数' })
  expectedPayable?: number;

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
