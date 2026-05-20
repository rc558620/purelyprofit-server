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

export class BusinessAnalysisCompareDataDto {
  @ApiProperty({ example: 1280, description: '当前值' })
  @IsNumber({}, { message: '当前值必须是数字' })
  current: number;

  @ApiProperty({ example: 960, description: '上期值' })
  @IsNumber({}, { message: '上期值必须是数字' })
  previous: number;

  @ApiPropertyOptional({
    example: 33.33,
    description: '变化率百分比；上期为 0 时为 null',
  })
  @IsOptional()
  @IsNumber({}, { message: '变化率必须是数字' })
  changeRate: number | null;
}

export class BusinessAnalysisHeroSummaryDto {
  @ApiProperty({
    type: BusinessAnalysisCompareDataDto,
    description: '净利润对比',
  })
  @ValidateNested()
  @Type(() => BusinessAnalysisCompareDataDto)
  netProfit: BusinessAnalysisCompareDataDto;

  @ApiProperty({
    type: BusinessAnalysisCompareDataDto,
    description: '总收入对比',
  })
  @ValidateNested()
  @Type(() => BusinessAnalysisCompareDataDto)
  revenue: BusinessAnalysisCompareDataDto;

  @ApiProperty({
    type: BusinessAnalysisCompareDataDto,
    description: '总成本对比',
  })
  @ValidateNested()
  @Type(() => BusinessAnalysisCompareDataDto)
  totalCost: BusinessAnalysisCompareDataDto;

  @ApiProperty({
    type: BusinessAnalysisCompareDataDto,
    description: '利润率对比',
  })
  @ValidateNested()
  @Type(() => BusinessAnalysisCompareDataDto)
  profitRate: BusinessAnalysisCompareDataDto;

  @ApiProperty({ example: 32, description: '当前周期订单数' })
  @IsInt({ message: '订单数必须是整数' })
  orderCount: number;
}

export class BusinessAnalysisDailyTrendDto {
  @ApiProperty({ example: '05/14', description: '日期标签' })
  @IsString({ message: '日期标签必须是字符串' })
  dateLabel: string;

  @ApiProperty({ example: 1580, description: '收入金额' })
  @IsNumber({}, { message: '收入金额必须是数字' })
  revenue: number;

  @ApiProperty({ example: 620, description: '净利润金额' })
  @IsNumber({}, { message: '净利润金额必须是数字' })
  profit: number;

  @ApiProperty({ example: 960, description: '成本金额' })
  @IsNumber({}, { message: '成本金额必须是数字' })
  cost: number;
}

export class BusinessAnalysisCategoryShareDto {
  @ApiProperty({ example: '饮品', description: '品类名称' })
  @IsString({ message: '品类名称必须是字符串' })
  name: string;

  @ApiProperty({ example: 1800, description: '品类收入' })
  @IsNumber({}, { message: '品类收入必须是数字' })
  revenue: number;

  @ApiProperty({ example: 760, description: '品类利润' })
  @IsNumber({}, { message: '品类利润必须是数字' })
  profit: number;

  @ApiProperty({ example: 42.22, description: '品类利润率' })
  @IsNumber({}, { message: '品类利润率必须是数字' })
  profitRate: number;

  @ApiProperty({ example: 120, description: '品类销量' })
  @IsInt({ message: '品类销量必须是整数' })
  quantity: number;

  @ApiProperty({ example: 36.5, description: '品类收入占比' })
  @IsNumber({}, { message: '品类收入占比必须是数字' })
  revenueShare: number;
}

export class BusinessAnalysisCostRateItemDto {
  @ApiProperty({ example: '进货成本', description: '成本名称' })
  @IsString({ message: '成本名称必须是字符串' })
  label: string;

  @ApiProperty({ example: 880, description: '成本金额' })
  @IsNumber({}, { message: '成本金额必须是数字' })
  amount: number;

  @ApiProperty({ example: 42.5, description: '成本占比' })
  @IsNumber({}, { message: '成本占比必须是数字' })
  percentage: number;

  @ApiProperty({ example: '#f97316', description: '图表颜色' })
  @IsString({ message: '图表颜色必须是字符串' })
  color: string;
}

export class BusinessAnalysisRankProductDto {
  @ApiProperty({ example: '12', description: '商品 ID' })
  @IsString({ message: '商品 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  @IsString({ message: '商品名称必须是字符串' })
  name: string;

  @ApiProperty({ example: '饮品', description: '品类名称' })
  @IsString({ message: '品类名称必须是字符串' })
  category: string;

  @ApiProperty({ example: 38.46, description: '利润率' })
  @IsNumber({}, { message: '利润率必须是数字' })
  profitRate: number;

  @ApiProperty({ example: 360, description: '总利润' })
  @IsNumber({}, { message: '总利润必须是数字' })
  totalProfit: number;

  @ApiProperty({ example: 936, description: '总收入' })
  @IsNumber({}, { message: '总收入必须是数字' })
  totalRevenue: number;

  @ApiProperty({ example: 144, description: '销量' })
  @IsInt({ message: '销量必须是整数' })
  quantity: number;

  @ApiPropertyOptional({
    example: 'https://example.com/coke.png',
    description: '商品图片',
  })
  @IsOptional()
  @IsString({ message: '商品图片必须是字符串' })
  image?: string;
}

export class BusinessAnalysisResponseDto {
  @ApiProperty({
    type: BusinessAnalysisHeroSummaryDto,
    description: '头部经营汇总',
  })
  @ValidateNested()
  @Type(() => BusinessAnalysisHeroSummaryDto)
  heroSummary: BusinessAnalysisHeroSummaryDto;

  @ApiProperty({
    type: [BusinessAnalysisDailyTrendDto],
    description: '收支趋势数据',
  })
  @IsArray({ message: '收支趋势必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => BusinessAnalysisDailyTrendDto)
  dailyTrend: BusinessAnalysisDailyTrendDto[];

  @ApiProperty({
    type: [BusinessAnalysisCategoryShareDto],
    description: '品类收入占比',
  })
  @IsArray({ message: '品类收入占比必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => BusinessAnalysisCategoryShareDto)
  categoryShares: BusinessAnalysisCategoryShareDto[];

  @ApiProperty({
    type: [BusinessAnalysisCostRateItemDto],
    description: '成本结构项',
  })
  @IsArray({ message: '成本结构项必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => BusinessAnalysisCostRateItemDto)
  costRateItems: BusinessAnalysisCostRateItemDto[];

  @ApiProperty({
    type: [BusinessAnalysisRankProductDto],
    description: '商品利润排行',
  })
  @IsArray({ message: '商品利润排行必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => BusinessAnalysisRankProductDto)
  rankProducts: BusinessAnalysisRankProductDto[];
}
