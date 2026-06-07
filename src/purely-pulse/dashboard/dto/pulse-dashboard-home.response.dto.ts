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

export class PulseDashboardOnlineStatsDto {
  @ApiProperty({ example: 2847, description: '当前实时在线人数' })
  @IsInt()
  onlineCount: number;

  @ApiProperty({ example: 5120, description: '今日峰值在线人数' })
  @IsInt()
  onlinePeak: number;

  @ApiProperty({
    example: 12.0,
    description: '较昨日同期在线人数变化率（%），正数为增长',
  })
  @IsNumber()
  onlineChangeRatio: number;

  @ApiProperty({
    example: [1200, 1800, 2200, 3100, 2847, 2600, 2900, 3400, 3100, 2847],
    description: '近 10 个时间点在线人数趋势（用于 sparkline）',
    type: [Number],
  })
  @IsArray()
  onlineTrend: number[];
}

export class PulseDashboardPartnerStatsDto {
  @ApiProperty({ example: 312, description: '合伙人总人数' })
  @IsInt()
  total: number;

  @ApiProperty({ example: 28, description: '本月新增合伙人数' })
  @IsInt()
  newThisMonth: number;

  @ApiProperty({ example: 78, description: '本月活跃合伙人比例（整数百分比）' })
  @IsInt()
  activeRate: number;

  @ApiProperty({
    example: 124800,
    description: '全平台推广带来的总充值金额（分）',
  })
  @IsInt()
  totalRevenue: number;

  @ApiProperty({ example: 3640, description: '全平台推广累计订阅单数' })
  @IsInt()
  totalOrders: number;

  @ApiProperty({ example: 400, description: '人均贡献金额（分）' })
  @IsInt()
  avgPerPartner: number;
}

export class PulseDashboardPartnerTopItemDto {
  @ApiProperty({ example: '张三', description: '合伙人姓名' })
  @IsString()
  name: string;

  @ApiProperty({ example: '上海', description: '合伙人所在城市' })
  @IsString()
  city: string;

  @ApiProperty({ example: 240, description: '推广订阅单数' })
  @IsInt()
  orders: number;

  @ApiProperty({ example: 12000, description: '推广带来的充值金额（分）' })
  @IsInt()
  revenue: number;
}

export class PulseDashboardRevenueTrendDto {
  @ApiProperty({
    example: ['0:00', '3:00', '6:00', '9:00'],
    description: '横轴时间标签（周期不同，格式不同）',
    type: [String],
  })
  @IsArray()
  dates: string[];

  @ApiProperty({
    example: [120, 80, 200, 680],
    description: '对应时间点的充值收入（分）',
    type: [Number],
  })
  @IsArray()
  values: number[];
}

export class PulseDashboardRevenueSummaryDto {
  @ApiProperty({ example: 6730, description: '当前周期总充值收入（分）' })
  @IsInt()
  total: number;

  @ApiProperty({ example: 841, description: '当前周期日均充值收入（分）' })
  @IsInt()
  avg: number;

  @ApiProperty({
    example: 18.2,
    description: '较上期同比增长率（%），保留 1 位小数',
  })
  @IsNumber()
  growth: number;

  @ApiPropertyOptional({
    example: 42,
    description: '当前周期订单数，收入明细页使用',
  })
  @IsOptional()
  @IsInt()
  orders?: number;

  @ApiPropertyOptional({
    example: 29900,
    description: '当前周期峰值收入（分），收入明细页使用',
  })
  @IsOptional()
  @IsInt()
  peak?: number;
}

export class PulseDashboardRevenueTypeItemDto {
  @ApiProperty({ example: '月卡会员', description: '充值类型名称' })
  @IsString()
  label: string;

  @ApiProperty({ example: 48, description: '占比（整数百分比）' })
  @IsInt()
  value: number;
}

export class PulseDashboardHomeResponseDto {
  @ApiProperty({
    type: PulseDashboardOnlineStatsDto,
    description: 'LIVE 在线人数卡片数据（实时）',
  })
  @ValidateNested()
  @Type(() => PulseDashboardOnlineStatsDto)
  online: PulseDashboardOnlineStatsDto;

  @ApiProperty({
    type: PulseDashboardPartnerStatsDto,
    description: '合伙人快览统计（总人数 / 本月新增 / 活跃率 / 总收益）',
  })
  @ValidateNested()
  @Type(() => PulseDashboardPartnerStatsDto)
  partnerStats: PulseDashboardPartnerStatsDto;

  @ApiProperty({
    type: [PulseDashboardPartnerTopItemDto],
    description: '合伙人推广排行 TOP5（按订单数/收益降序）',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseDashboardPartnerTopItemDto)
  partnerTop: PulseDashboardPartnerTopItemDto[];

  @ApiProperty({
    type: PulseDashboardRevenueTrendDto,
    description: '充值收入趋势折线图数据',
  })
  @ValidateNested()
  @Type(() => PulseDashboardRevenueTrendDto)
  revenueTrend: PulseDashboardRevenueTrendDto;

  @ApiProperty({
    type: PulseDashboardRevenueSummaryDto,
    description: '充值收入汇总（总额 / 日均 / 同比增长）',
  })
  @ValidateNested()
  @Type(() => PulseDashboardRevenueSummaryDto)
  revenueSummary: PulseDashboardRevenueSummaryDto;

  @ApiProperty({
    type: [PulseDashboardRevenueTypeItemDto],
    description: '充值类型占比分布（月卡 / 季卡 / 年卡 / 其他）',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseDashboardRevenueTypeItemDto)
  revenueTypeBreakdown: PulseDashboardRevenueTypeItemDto[];

  @ApiProperty({
    example: 5,
    description: '待审核合伙人申请数（用于首页小红点提示）',
  })
  @IsInt()
  pendingApplicationCount: number;

  @ApiProperty({ example: 1747212600000, description: '接口生成时间戳（ms）' })
  @IsInt()
  generatedAt: number;
}
