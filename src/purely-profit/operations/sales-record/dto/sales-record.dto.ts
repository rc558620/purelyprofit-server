import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PaginationQueryDto,
  transformOptionalBoolean,
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../../stores/dto/store-response.dto';
import {
  SALES_CALC_MODE_VALUES,
  SALES_PAYMENT_METHOD_VALUES,
  SALES_RECORD_PERIOD_VALUES,
  type SalesCalcModeValue,
  type SalesPaymentMethodValue,
  type SalesRecordPeriodValue,
} from '../sales-record.types';

export class SalesRecordItemInputDto {
  @ApiPropertyOptional({
    example: '1',
    description: '商品 ID；手动录单可传自定义字符串或不传',
  })
  @IsOptional()
  @IsString({ message: '商品 ID 必须是字符串' })
  @MaxLength(100, { message: '商品 ID 最长 100 个字符' })
  productId?: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称快照' })
  @IsString({ message: '商品名称必须是字符串' })
  @MinLength(1, { message: '商品名称不能为空' })
  @MaxLength(100, { message: '商品名称最长 100 个字符' })
  productName: string;

  @ApiProperty({ example: '饮品', description: '商品分类快照' })
  @IsString({ message: '商品分类必须是字符串' })
  @MinLength(1, { message: '商品分类不能为空' })
  @MaxLength(30, { message: '商品分类最长 30 个字符' })
  categoryName: string;

  @ApiProperty({ example: 6.5, description: '销售单价（元）；抵扣项可为负数' })
  @Type(() => Number)
  @IsNumber({}, { message: '销售单价必须是数字' })
  salePrice: number;

  @ApiProperty({ example: 2.5, description: '单件利润（元）；抵扣项可为负数' })
  @Type(() => Number)
  @IsNumber({}, { message: '单件利润必须是数字' })
  profit: number;

  @ApiProperty({ example: 2, description: '销售数量' })
  @Type(() => Number)
  @IsInt({ message: '销售数量必须是整数' })
  @Min(1, { message: '销售数量必须大于 0' })
  quantity: number;
}

export class CreateSalesRecordDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ type: [SalesRecordItemInputDto], description: '销售商品明细' })
  @IsArray({ message: '销售商品明细必须是数组' })
  @ArrayMinSize(1, { message: '请至少填写一条商品明细' })
  @ValidateNested({ each: true })
  @Type(() => SalesRecordItemInputDto)
  items: SalesRecordItemInputDto[];

  @ApiProperty({
    example: 'cash',
    enum: SALES_PAYMENT_METHOD_VALUES,
    description: '支付方式',
  })
  @IsIn(SALES_PAYMENT_METHOD_VALUES, { message: '支付方式不合法' })
  paymentMethod: SalesPaymentMethodValue;

  @ApiProperty({
    example: 'business',
    enum: SALES_CALC_MODE_VALUES,
    description: '结算模式',
  })
  @IsIn(SALES_CALC_MODE_VALUES, { message: '结算模式不合法' })
  calcMode: SalesCalcModeValue;

  @ApiPropertyOptional({ example: '晚高峰补录', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;

  @ApiPropertyOptional({
    example: 1715695200000,
    description: '销售时间戳（毫秒）；不传默认当前时间',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '销售时间必须是整数时间戳' })
  @Min(0, { message: '销售时间不合法' })
  date?: number;

  // ─── 团购 / 券 / 平台结算元数据（可选，空间结账时传入）───────────────────────

  @ApiPropertyOptional({
    example: 'groupon_voucher',
    description: '顾客实际支付方式（如 groupon_voucher）',
  })
  @IsOptional()
  @IsString({ message: '顾客支付方式必须是字符串' })
  @MaxLength(50, { message: '顾客支付方式最长 50 个字符' })
  customerPaymentMethod?: string;

  @ApiPropertyOptional({ example: 'MT123456', description: '团购券码' })
  @IsOptional()
  @IsString({ message: '团购券码必须是字符串' })
  @MaxLength(100, { message: '团购券码最长 100 个字符' })
  grouponCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '团购平台' })
  @IsOptional()
  @IsString({ message: '团购平台必须是字符串' })
  @MaxLength(50, { message: '团购平台最长 50 个字符' })
  grouponPlatform?: string;

  @ApiPropertyOptional({ example: 'online', description: '结算渠道' })
  @IsOptional()
  @IsString({ message: '结算渠道必须是字符串' })
  @MaxLength(50, { message: '结算渠道最长 50 个字符' })
  settlementChannel?: string;

  @ApiPropertyOptional({ example: 'V20260710001', description: '券码' })
  @IsOptional()
  @IsString({ message: '券码必须是字符串' })
  @MaxLength(100, { message: '券码最长 100 个字符' })
  voucherCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '券所属平台' })
  @IsOptional()
  @IsString({ message: '券所属平台必须是字符串' })
  @MaxLength(50, { message: '券所属平台最长 50 个字符' })
  voucherPlatform?: string;

  @ApiPropertyOptional({ example: 100, description: '券面额（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '券面额必须是数字' })
  @Min(0, { message: '券面额不能为负数' })
  voucherFaceAmount?: number;

  @ApiPropertyOptional({ example: 'pending', description: '平台结算状态' })
  @IsOptional()
  @IsString({ message: '结算状态必须是字符串' })
  @MaxLength(30, { message: '结算状态最长 30 个字符' })
  settlementStatus?: string;

  @ApiPropertyOptional({ example: 80, description: '平台应收金额（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '平台应收金额必须是数字' })
  @Min(0, { message: '平台应收金额不能为负数' })
  platformReceivable?: number;

  @ApiPropertyOptional({ example: 75, description: '平台已结金额（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '平台已结金额必须是数字' })
  @Min(0, { message: '平台已结金额不能为负数' })
  platformSettledAmount?: number;

  @ApiPropertyOptional({ example: 5, description: '平台手续费（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '平台手续费必须是数字' })
  @Min(0, { message: '平台手续费不能为负数' })
  platformFee?: number;
}

export class ListSalesRecordsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    example: 'today',
    enum: SALES_RECORD_PERIOD_VALUES,
    description: '时间周期；默认 today',
  })
  @IsOptional()
  @IsIn(SALES_RECORD_PERIOD_VALUES, { message: '时间周期不合法' })
  period?: SalesRecordPeriodValue;

  @ApiPropertyOptional({
    example: 2026,
    description: '按年筛选时的年份；不传默认当前年',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '年份必须是整数' })
  @Min(1970, { message: '年份不合法' })
  year?: number;

  @ApiPropertyOptional({
    example: 1715558400000,
    description: '自定义单日时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '自定义日期必须是整数时间戳' })
  @Min(0, { message: '自定义日期不合法' })
  customDate?: number;

  @ApiPropertyOptional({
    example: 1715558400000,
    description: '区间开始时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间开始时间必须是整数时间戳' })
  @Min(0, { message: '区间开始时间不合法' })
  rangeStartDate?: number;

  @ApiPropertyOptional({
    example: 1715644799999,
    description: '区间结束时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间结束时间必须是整数时间戳' })
  @Min(0, { message: '区间结束时间不合法' })
  rangeEndDate?: number;
}

export class SalesStatsQueryDto extends ListSalesRecordsQueryDto {}

export class SalesReportQueryDto extends ListSalesRecordsQueryDto {
  @ApiPropertyOptional({
    example: false,
    description: '是否按导出模式拉取数据',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: '导出标记必须是布尔值' })
  export?: boolean;

  @ApiPropertyOptional({
    enum: ['json', 'csv'],
    description: '导出格式，默认 json；csv 时服务端直接流式返回 CSV 文件',
  })
  @IsOptional()
  @IsIn(['json', 'csv'], { message: 'format 只支持 json 或 csv' })
  format?: 'json' | 'csv';
}

export class ListSalesProductsQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({ example: '可乐', description: '商品名称或编号关键字' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '关键字必须是字符串' })
  keyword?: string;

  @ApiPropertyOptional({ example: '饮品', description: '分类名称' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '分类名称必须是字符串' })
  category?: string;
}

// ─── Response DTOs 已抽离到 sales-record-response.dto.ts ─────────────────────
export {
  SalesProductResponseDto,
  SalesRecordItemResponseDto,
  PreviewSalesRecordItemDto,
  PreviewSalesRecordResponseDto,
  SalesRecordResponseDto,
  SalesStatsResponseDto,
  SalesReportSummaryDto,
  SalesDailyRowDto,
  SalesReportResponseDto,
  SalesRecordListResponseDto,
} from './sales-record-response.dto';
