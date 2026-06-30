import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class BusinessAnalysisCompareDataDto {
  @ApiProperty({ example: 1280, description: '当前值' })
  current: number;

  @ApiProperty({ example: 960, description: '上期值' })
  previous: number;

  @ApiPropertyOptional({
    example: 33.33,
    description: '变化率百分比；上期为 0 时为 null',
  })
  changeRate: number | null;
}

export class BusinessAnalysisHeroSummaryDto {
  @ApiProperty({
    type: BusinessAnalysisCompareDataDto,
    description: '净利润对比',
  })
  @Type(() => BusinessAnalysisCompareDataDto)
  netProfit: BusinessAnalysisCompareDataDto;

  @ApiProperty({
    type: BusinessAnalysisCompareDataDto,
    description: '总收入对比',
  })
  @Type(() => BusinessAnalysisCompareDataDto)
  revenue: BusinessAnalysisCompareDataDto;

  @ApiProperty({
    type: BusinessAnalysisCompareDataDto,
    description: '总成本对比',
  })
  @Type(() => BusinessAnalysisCompareDataDto)
  totalCost: BusinessAnalysisCompareDataDto;

  @ApiProperty({
    type: BusinessAnalysisCompareDataDto,
    description: '利润率对比',
  })
  @Type(() => BusinessAnalysisCompareDataDto)
  profitRate: BusinessAnalysisCompareDataDto;

  @ApiProperty({
    type: BusinessAnalysisCompareDataDto,
    description: '成本率对比',
  })
  @Type(() => BusinessAnalysisCompareDataDto)
  costRate: BusinessAnalysisCompareDataDto;

  @ApiProperty({ example: 32, description: '当前周期订单数' })
  orderCount: number;
}

export class BusinessAnalysisDailyTrendDto {
  @ApiProperty({ example: '05/14', description: '日期标签' })
  dateLabel: string;

  @ApiProperty({ example: 1580, description: '收入金额' })
  revenue: number;

  @ApiProperty({ example: 620, description: '净利润金额' })
  profit: number;

  @ApiProperty({ example: 960, description: '成本金额' })
  cost: number;
}

export class BusinessAnalysisCategoryShareDto {
  @ApiProperty({ example: '饮品', description: '品类名称' })
  name: string;

  @ApiProperty({ example: 1800, description: '品类收入' })
  revenue: number;

  @ApiProperty({ example: 760, description: '品类利润' })
  profit: number;

  @ApiProperty({ example: 42.22, description: '品类利润率' })
  profitRate: number;

  @ApiProperty({ example: 120, description: '品类销量' })
  quantity: number;

  @ApiProperty({ example: 36.5, description: '品类收入占比' })
  revenueShare: number;
}

export class BusinessAnalysisCostRateItemDto {
  @ApiProperty({ example: '进货成本', description: '成本名称' })
  label: string;

  @ApiProperty({ example: 880, description: '成本金额' })
  amount: number;

  @ApiProperty({ example: 42.5, description: '成本占比' })
  percentage: number;

  @ApiProperty({ example: '#f97316', description: '图表颜色' })
  color: string;
}

export class BusinessAnalysisRankProductDto {
  @ApiProperty({ example: '12', description: '商品 ID' })
  id: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  name: string;

  @ApiProperty({ example: '饮品', description: '品类名称' })
  category: string;

  @ApiProperty({ example: 38.46, description: '利润率' })
  profitRate: number;

  @ApiProperty({ example: 360, description: '总利润' })
  totalProfit: number;

  @ApiProperty({ example: 936, description: '总收入' })
  totalRevenue: number;

  @ApiProperty({ example: 144, description: '销量' })
  quantity: number;

  @ApiPropertyOptional({
    example: 'https://example.com/coke.png',
    description: '商品图片',
  })
  image?: string;
}

export class BusinessAnalysisResponseDto {
  @ApiProperty({
    type: BusinessAnalysisHeroSummaryDto,
    description: '头部经营汇总',
  })
  @Type(() => BusinessAnalysisHeroSummaryDto)
  heroSummary: BusinessAnalysisHeroSummaryDto;

  @ApiProperty({
    type: [BusinessAnalysisDailyTrendDto],
    description: '收支趋势数据',
  })
  @Type(() => BusinessAnalysisDailyTrendDto)
  dailyTrend: BusinessAnalysisDailyTrendDto[];

  @ApiProperty({
    type: [BusinessAnalysisCategoryShareDto],
    description: '品类收入占比',
  })
  @Type(() => BusinessAnalysisCategoryShareDto)
  categoryShares: BusinessAnalysisCategoryShareDto[];

  @ApiProperty({
    type: [BusinessAnalysisCostRateItemDto],
    description: '成本结构项',
  })
  @Type(() => BusinessAnalysisCostRateItemDto)
  costRateItems: BusinessAnalysisCostRateItemDto[];

  @ApiProperty({
    type: [BusinessAnalysisRankProductDto],
    description: '商品利润排行',
  })
  @Type(() => BusinessAnalysisRankProductDto)
  rankProducts: BusinessAnalysisRankProductDto[];
}
