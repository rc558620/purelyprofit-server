import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ProfitSummaryDto {
  @ApiProperty({ example: 1280, description: '总收入（元）' })
  @IsNumber({}, { message: '总收入必须是数字' })
  revenue: number;

  @ApiProperty({ example: 860, description: '总成本（元）' })
  @IsNumber({}, { message: '总成本必须是数字' })
  totalCost: number;

  @ApiProperty({ example: 420, description: '净利润（元）' })
  @IsNumber({}, { message: '净利润必须是数字' })
  netProfit: number;

  @ApiProperty({ example: 32.81, description: '利润率（%）' })
  @IsNumber({}, { message: '利润率必须是数字' })
  profitRate: number;

  @ApiPropertyOptional({
    example: 18.6,
    description: '收入较上期变化百分比；无上期数据时为 null',
  })
  @IsOptional()
  @IsNumber({}, { message: '收入较上期变化必须是数字' })
  revenueCompareLastPeriod: number | null;

  @ApiPropertyOptional({
    example: -5.2,
    description: '净利润较上期变化百分比；无上期数据时为 null',
  })
  @IsOptional()
  @IsNumber({}, { message: '净利润较上期变化必须是数字' })
  profitCompareLastPeriod: number | null;

  @ApiPropertyOptional({
    example: 12.3,
    description: '成本较上期变化百分比；无上期数据时为 null',
  })
  @IsOptional()
  @IsNumber({}, { message: '成本较上期变化必须是数字' })
  costCompareLastPeriod: number | null;

  @ApiProperty({ example: 56, description: '销量总数' })
  @IsInt({ message: '销量总数必须是整数' })
  orderCount: number;
}

export class DailyProfitDto {
  @ApiProperty({ example: '05/14', description: '日期标签' })
  @IsString({ message: '日期标签必须是字符串' })
  dateLabel: string;

  @ApiProperty({ example: 1580, description: '收入金额' })
  @IsNumber({}, { message: '收入金额必须是数字' })
  revenue: number;

  @ApiProperty({ example: 960, description: '成本金额' })
  @IsNumber({}, { message: '成本金额必须是数字' })
  cost: number;

  @ApiProperty({ example: 620, description: '净利润金额' })
  @IsNumber({}, { message: '净利润金额必须是数字' })
  profit: number;
}

export class ProductRankItemDto {
  @ApiProperty({ example: '12', description: '商品 ID' })
  @IsString({ message: '商品 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  @IsString({ message: '商品名称必须是字符串' })
  name: string;

  @ApiProperty({ example: '饮品', description: '商品分类' })
  @IsString({ message: '商品分类必须是字符串' })
  category: string;

  @ApiProperty({ example: 6.5, description: '商品售价（元）' })
  @IsNumber({}, { message: '商品售价必须是数字' })
  price: number;

  @ApiProperty({ example: 2.5, description: '单件利润（元）' })
  @IsNumber({}, { message: '单件利润必须是数字' })
  profitPerUnit: number;

  @ApiProperty({ example: 12, description: '销售数量' })
  @IsInt({ message: '销售数量必须是整数' })
  quantity: number;

  @ApiProperty({ example: 30, description: '总利润（元）' })
  @IsNumber({}, { message: '总利润必须是数字' })
  totalProfit: number;

  @ApiProperty({ example: 78, description: '总收入（元）' })
  @IsNumber({}, { message: '总收入必须是数字' })
  totalRevenue: number;

  @ApiProperty({ example: 38.46, description: '利润率（%）' })
  @IsNumber({}, { message: '利润率必须是数字' })
  profitRate: number;

  @ApiPropertyOptional({
    example: 'https://example.com/coke.png',
    description: '商品图片',
  })
  @IsOptional()
  @IsString({ message: '商品图片必须是字符串' })
  image?: string;
}

export class ProfitReportProductRowDto {
  @ApiProperty({ example: '12', description: '商品 ID' })
  @IsString({ message: '商品 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  @IsString({ message: '商品名称必须是字符串' })
  name: string;

  @ApiProperty({ example: '饮品', description: '商品分类' })
  @IsString({ message: '商品分类必须是字符串' })
  category: string;

  @ApiProperty({ example: 12, description: '销售数量' })
  @IsInt({ message: '销售数量必须是整数' })
  quantity: number;

  @ApiProperty({ example: 78, description: '总收入（元）' })
  @IsNumber({}, { message: '总收入必须是数字' })
  totalRevenue: number;

  @ApiProperty({ example: 30, description: '总利润（元）' })
  @IsNumber({}, { message: '总利润必须是数字' })
  totalProfit: number;

  @ApiProperty({ example: 38.46, description: '利润率（%）' })
  @IsNumber({}, { message: '利润率必须是数字' })
  profitRate: number;
}

export class CostBreakdownItemDto {
  @ApiProperty({ example: '租金', description: '成本名称' })
  @IsString({ message: '成本名称必须是字符串' })
  label: string;

  @ApiProperty({ example: 880, description: '成本金额' })
  @IsNumber({}, { message: '成本金额必须是数字' })
  amount: number;

  @ApiProperty({ example: '#6366f1', description: '图表颜色' })
  @IsString({ message: '图表颜色必须是字符串' })
  color: string;

  @ApiProperty({ example: 42.5, description: '成本占比（%）' })
  @IsNumber({}, { message: '成本占比必须是数字' })
  percentage: number;
}

export class ProfitReportResponseDto {
  @ApiProperty({
    type: ProfitSummaryDto,
    description: '报表中心利润概况',
  })
  @ValidateNested()
  @Type(() => ProfitSummaryDto)
  summary: ProfitSummaryDto;

  @ApiProperty({
    type: [ProfitReportProductRowDto],
    description: '报表中心商品利润排行',
  })
  @IsArray({ message: '报表中心商品利润排行必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => ProfitReportProductRowDto)
  products: ProfitReportProductRowDto[];
}

export class ProfitDetailResponseDto {
  @ApiProperty({
    type: ProfitSummaryDto,
    description: '利润总览',
  })
  @ValidateNested()
  @Type(() => ProfitSummaryDto)
  summary: ProfitSummaryDto;

  @ApiProperty({
    type: [DailyProfitDto],
    description: '每日利润趋势',
  })
  @IsArray({ message: '每日利润趋势必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => DailyProfitDto)
  dailyProfits: DailyProfitDto[];

  @ApiProperty({
    type: [ProductRankItemDto],
    description: '商品利润排行',
  })
  @IsArray({ message: '商品利润排行必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => ProductRankItemDto)
  productRanking: ProductRankItemDto[];

  @ApiProperty({
    type: [CostBreakdownItemDto],
    description: '成本结构分解',
  })
  @IsArray({ message: '成本结构分解必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => CostBreakdownItemDto)
  costBreakdown: CostBreakdownItemDto[];
}
