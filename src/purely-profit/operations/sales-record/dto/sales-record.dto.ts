import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { StaffRole } from '@prisma/client';
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
  PaginationMetaDto,
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

  @ApiProperty({ example: 88.5, description: '总营业额（前端汇总值）' })
  @Type(() => Number)
  @IsNumber({}, { message: '总营业额必须是数字' })
  totalRevenue: number;

  @ApiProperty({ example: 23.6, description: '总利润（前端汇总值）' })
  @Type(() => Number)
  @IsNumber({}, { message: '总利润必须是数字' })
  totalProfit: number;

  @ApiProperty({
    example: 8,
    description: '总销售件数（前端汇总值，不含抵扣项）',
  })
  @Type(() => Number)
  @IsInt({ message: '总销售件数必须是整数' })
  @Min(1, { message: '总销售件数必须大于 0' })
  totalQuantity: number;

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

export class SalesProductResponseDto {
  @ApiProperty({ example: '1', description: '商品 ID' })
  id: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  name: string;

  @ApiProperty({ example: '饮品', description: '商品分类' })
  category: string;

  @ApiProperty({ example: 'COLA001', description: '商品编号' })
  code: string;

  @ApiProperty({ example: 2.5, description: '单件利润（对应前端 price）' })
  price: number;

  @ApiProperty({ example: 6.5, description: '销售单价（对应前端 salePrice）' })
  salePrice: number;

  @ApiProperty({ example: 0, description: '当前追加数量，固定返回 0' })
  quantity: number;
}

export class SalesRecordItemResponseDto {
  @ApiProperty({
    example: '1',
    description: '商品 ID；手动录单为生成的字符串 ID',
  })
  productId: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称快照' })
  productName: string;

  @ApiProperty({ example: '饮品', description: '商品分类快照' })
  categoryName: string;

  @ApiProperty({ example: 6.5, description: '销售单价（元）' })
  salePrice: number;

  @ApiProperty({ example: 2.5, description: '单件利润（元）' })
  profit: number;

  @ApiProperty({ example: 2, description: '销售数量' })
  quantity: number;
}

export class SalesRecordResponseDto {
  @ApiProperty({ example: '1', description: '销售记录 ID' })
  id: string;

  @ApiProperty({ example: '#20260514-001', description: '订单号' })
  orderNo: string;

  @ApiProperty({ type: [SalesRecordItemResponseDto], description: '商品明细' })
  items: SalesRecordItemResponseDto[];

  @ApiProperty({ example: 88.5, description: '总营业额（元）' })
  totalRevenue: number;

  @ApiProperty({ example: 23.6, description: '总利润（元）' })
  totalProfit: number;

  @ApiProperty({ example: 8, description: '总销售件数' })
  totalQuantity: number;

  @ApiProperty({
    example: 'cash',
    enum: SALES_PAYMENT_METHOD_VALUES,
    description: '支付方式',
  })
  paymentMethod: SalesPaymentMethodValue;

  @ApiProperty({
    example: 'business',
    enum: SALES_CALC_MODE_VALUES,
    description: '结算模式',
  })
  calcMode: SalesCalcModeValue;

  @ApiPropertyOptional({ example: '晚高峰补录', description: '备注' })
  note?: string;

  @ApiPropertyOptional({
    example: '张三',
    description: '操作员姓名快照；主账号或无员工档案时为 null',
  })
  operatorName?: string | null;

  @ApiPropertyOptional({
    enum: StaffRole,
    example: 'OWNER',
    description:
      '操作员角色（OWNER=老板/MANAGER=店长/STAFF=收银员）；主账号或无员工档案时为 null',
    nullable: true,
  })
  operatorRole?: StaffRole | null;

  @ApiProperty({ example: 1715695200000, description: '销售时间戳（毫秒）' })
  date: number;

  @ApiProperty({ example: 1715695201000, description: '创建时间戳（毫秒）' })
  createdAt: number;
}

export class SalesStatsResponseDto {
  @ApiProperty({ example: 1200.5, description: '当前筛选周期总营业额' })
  totalRevenue: number;

  @ApiProperty({ example: 320.2, description: '当前筛选周期总利润' })
  totalProfit: number;

  @ApiProperty({ example: 18, description: '当前筛选周期订单笔数' })
  orderCount: number;

  @ApiProperty({ example: 66.69, description: '平均客单价' })
  avgOrderValue: number;

  @ApiPropertyOptional({
    example: 12.5,
    description: '较上期营业额变化百分比；无对比数据时为 null',
  })
  compareLastPeriod: number | null;
}

export class SalesReportSummaryDto {
  @ApiProperty({ example: 56, description: '销售总数量' })
  totalQuantity: number;

  @ApiProperty({ example: 1280, description: '销售总收入' })
  totalRevenue: number;

  @ApiProperty({ example: 12, description: '销售明细条数' })
  orderCount: number;

  @ApiProperty({ example: 106.67, description: '平均单条销售额' })
  avgOrderValue: number;
}

export class SalesDailyRowDto {
  @ApiProperty({ example: '1715644800000-12', description: '聚合行 ID' })
  id: string;

  @ApiProperty({ example: '05/14', description: '日期标签' })
  dateLabel: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  productName: string;

  @ApiProperty({ example: 8, description: '销售数量' })
  quantity: number;

  @ApiProperty({ example: 52, description: '销售收入' })
  revenue: number;
}

export class SalesReportResponseDto {
  @ApiProperty({ type: SalesReportSummaryDto, description: '销售报表概况' })
  summary: SalesReportSummaryDto;

  @ApiProperty({ type: [SalesDailyRowDto], description: '按天聚合的销售明细' })
  dailySales: SalesDailyRowDto[];
}

export class SalesRecordListResponseDto {
  @ApiProperty({ type: [SalesRecordResponseDto], description: '销售记录列表' })
  items: SalesRecordResponseDto[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: '分页信息',
  })
  meta: PaginationMetaDto;
}
