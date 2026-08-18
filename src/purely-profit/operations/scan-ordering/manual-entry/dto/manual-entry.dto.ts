// 录入订单入参 DTO：明细行、价格预览与建单表单（金额入参仅券面金额，其余金额一律服务端计算）

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** 录入订单就餐方式（对齐前端 ManualEntryDiningMode；自取为 platform 子选项，由 isSelfPickup 标识） */
export const MANUAL_ENTRY_DINING_MODE_VALUES = ['dineIn', 'platform'] as const;
export type ManualEntryDiningModeValue =
  (typeof MANUAL_ENTRY_DINING_MODE_VALUES)[number];

/** 录入订单来源渠道（对齐前端 ManualEntrySourceChannel） */
export const MANUAL_ENTRY_SOURCE_CHANNEL_VALUES = [
  'meituan',
  'eleme',
  'meituanVoucher',
  'douyin',
  'dianping',
  'other',
] as const;
export type ManualEntrySourceChannelValue =
  (typeof MANUAL_ENTRY_SOURCE_CHANNEL_VALUES)[number];

/** 录入订单支付方式（对齐前端 ManualEntryPaymentMethod；platform 为平台结算） */
export const MANUAL_ENTRY_PAYMENT_METHOD_VALUES = [
  'cash',
  'wechat',
  'alipay',
  'card',
  'platform',
] as const;
export type ManualEntryPaymentMethodValue =
  (typeof MANUAL_ENTRY_PAYMENT_METHOD_VALUES)[number];

/** 券面金额上限（元）：防止异常大额输入 */
const VOUCHER_AMOUNT_MAX = 99999.99;

/** 平台单号格式：字母数字与短横线组合（兼容主流平台单号） */
const EXTERNAL_ORDER_NO_PATTERN = /^[A-Za-z0-9-]+$/;

export class ManualEntryItemDto {
  @ApiProperty({ example: 1, description: '扫码点餐菜单商品 ID' })
  @Type(() => Number)
  @IsInt({ message: '商品 ID 必须是整数' })
  @Min(1, { message: '商品 ID 不合法' })
  productId: number;

  @ApiPropertyOptional({
    example: [11, 23],
    description: '已选规格选项 ID 列表（无规格商品不传）',
  })
  @IsOptional()
  @IsArray({ message: '规格选项必须是数组' })
  @ArrayMaxSize(20, { message: '单行规格选项最多 20 个' })
  @IsInt({ each: true, message: '规格选项 ID 必须是整数' })
  @Min(1, { each: true, message: '规格选项 ID 不合法' })
  specOptionIds?: number[];

  @ApiProperty({ example: 2, description: '数量' })
  @Type(() => Number)
  @IsInt({ message: '数量必须是整数' })
  @Min(1, { message: '数量必须大于 0' })
  @Max(999, { message: '单行数量不能超过 999' })
  quantity: number;
}

export class ManualEntryPreviewDto {
  @ApiProperty({
    type: [ManualEntryItemDto],
    description: '订单明细行（同商品同规格由前端合并为一行）',
  })
  @IsArray({ message: '明细必须是数组' })
  @ArrayMinSize(1, { message: '请至少选择一件商品' })
  @ArrayMaxSize(50, { message: '单笔订单明细不能超过 50 行' })
  @ValidateNested({ each: true })
  @Type(() => ManualEntryItemDto)
  items: ManualEntryItemDto[];

  @ApiProperty({
    example: 'platform',
    enum: MANUAL_ENTRY_PAYMENT_METHOD_VALUES,
    description: '支付方式；platform 平台结算时券面金额参与抵扣',
  })
  @IsIn(MANUAL_ENTRY_PAYMENT_METHOD_VALUES, { message: '支付方式不合法' })
  paymentMethod: ManualEntryPaymentMethodValue;

  @ApiPropertyOptional({
    example: 100,
    description: '券面金额（元）；仅平台结算时生效，封顶抵扣不找零',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '券面金额必须是数字' })
  @Min(0, { message: '券面金额不能为负数' })
  @Max(VOUCHER_AMOUNT_MAX, { message: '券面金额超出允许范围' })
  voucherAmount?: number;
}

export class CreateManualEntryOrderDto {
  @ApiProperty({
    type: [ManualEntryItemDto],
    description: '订单明细行（同商品同规格由前端合并为一行）',
  })
  @IsArray({ message: '明细必须是数组' })
  @ArrayMinSize(1, { message: '请至少选择一件商品' })
  @ArrayMaxSize(50, { message: '单笔订单明细不能超过 50 行' })
  @ValidateNested({ each: true })
  @Type(() => ManualEntryItemDto)
  items: ManualEntryItemDto[];

  @ApiProperty({
    example: 'dineIn',
    enum: MANUAL_ENTRY_DINING_MODE_VALUES,
    description:
      '就餐方式（dineIn 堂食/团购到店、takeaway 自取、platform 第三方外卖）',
  })
  @IsIn(MANUAL_ENTRY_DINING_MODE_VALUES, { message: '就餐方式不合法' })
  diningMode: ManualEntryDiningModeValue;

  @ApiPropertyOptional({
    example: 3,
    description: '桌台 ID；堂食/团购到店必填',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '桌台 ID 必须是整数' })
  @Min(1, { message: '桌台 ID 不合法' })
  tableId?: number;

  @ApiPropertyOptional({
    example: 4,
    description: '就餐人数；堂食/团购到店填写',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '就餐人数必须是整数' })
  @Min(1, { message: '就餐人数必须大于 0' })
  @Max(99, { message: '就餐人数不能超过 99' })
  guestCount?: number;

  @ApiPropertyOptional({
    example: true,
    description: '第三方外卖是否自取（勾选后不分配桌台，支持叫号取餐）',
  })
  @IsOptional()
  @Type(() => Boolean)
  isSelfPickup?: boolean;

  @ApiPropertyOptional({
    example: '13800138000',
    description: '顾客手机号（选填，用于订单归属）',
  })
  @IsOptional()
  @IsString({ message: '顾客手机号必须是字符串' })
  @MaxLength(20, { message: '顾客手机号最长 20 个字符' })
  customerPhone?: string;

  @ApiPropertyOptional({
    example: 'meituanVoucher',
    enum: MANUAL_ENTRY_SOURCE_CHANNEL_VALUES,
    description: '来源渠道；第三方外卖与平台结算时必填',
  })
  @IsOptional()
  @IsIn(MANUAL_ENTRY_SOURCE_CHANNEL_VALUES, { message: '来源渠道不合法' })
  sourceChannel?: ManualEntrySourceChannelValue;

  @ApiPropertyOptional({
    example: 'MT20260815001',
    description: '第三方平台结算单号（选填，用于对账）',
  })
  @IsOptional()
  @IsString({ message: '平台单号必须是字符串' })
  @MinLength(3, { message: '平台单号至少 3 个字符' })
  @MaxLength(64, { message: '平台单号最长 64 个字符' })
  @Matches(EXTERNAL_ORDER_NO_PATTERN, {
    message: '平台单号仅支持字母、数字与短横线',
  })
  externalOrderNo?: string;

  @ApiPropertyOptional({
    example: 'DY20260815-001',
    description: '团购券码（选填；平台结算时填写，用于交班/销售记录展示）',
  })
  @IsOptional()
  @IsString({ message: '团购券码必须是字符串' })
  @MaxLength(64, { message: '团购券码最长 64 个字符' })
  grouponCode?: string;

  @ApiPropertyOptional({
    example: 100,
    description: '券面金额（元）；仅平台结算时生效，封顶抵扣不找零',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '券面金额必须是数字' })
  @Min(0, { message: '券面金额不能为负数' })
  @Max(VOUCHER_AMOUNT_MAX, { message: '券面金额超出允许范围' })
  voucherAmount?: number;

  @ApiProperty({
    example: 'platform',
    enum: MANUAL_ENTRY_PAYMENT_METHOD_VALUES,
    description: '支付方式；platform 平台结算时券面金额参与抵扣',
  })
  @IsIn(MANUAL_ENTRY_PAYMENT_METHOD_VALUES, { message: '支付方式不合法' })
  paymentMethod: ManualEntryPaymentMethodValue;

  @ApiPropertyOptional({ example: '少冰，放门口', description: '整单备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  remark?: string;
}
