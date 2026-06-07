import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PULSE_DASHBOARD_PERIOD_VALUES } from './pulse-dashboard-query.dto';

export class PulseDashboardStatsDto {
  @ApiProperty({ example: '今日净利润 (元)', description: '净利润卡片标题' })
  @IsString()
  profitLabel: string;

  @ApiProperty({ example: 1248.5, description: '当前周期净利润，单位元' })
  @IsNumber()
  profit: number;

  @ApiPropertyOptional({
    example: 12.5,
    description: '净利润较上期变化率（%），上期为 0 时为空',
  })
  @IsOptional()
  @IsNumber()
  profitChange: number | null;

  @ApiProperty({ example: '今日订单数', description: '订单卡片标题' })
  @IsString()
  orderLabel: string;

  @ApiProperty({ example: 86, description: '当前周期订单数' })
  @IsInt()
  orderCount: number;

  @ApiPropertyOptional({
    example: 5.2,
    description: '订单数较上期变化率（%），上期为 0 时为空',
  })
  @IsOptional()
  @IsNumber()
  orderChange: number | null;

  @ApiProperty({ example: 3200.0, description: '当前周期总收入，单位元' })
  @IsNumber()
  revenue: number;

  @ApiProperty({ example: 1951.5, description: '当前周期总成本，单位元' })
  @IsNumber()
  totalCost: number;
}

export class PulseDashboardSalesTrendDto {
  @ApiProperty({
    example: ['08:00', '10:00', '12:00'],
    description: '横轴标签',
  })
  @IsArray()
  categories: string[];

  @ApiProperty({
    example: [800, 1200, 1000, null],
    description: '实收数据，未来时段返回 null',
  })
  @IsArray()
  actual: Array<number | null>;

  @ApiProperty({ example: false, description: '是否为年度按月视图' })
  @IsBoolean()
  isYearMode: boolean;
}

export class PulseDashboardMetaDto {
  @ApiProperty({
    enum: PULSE_DASHBOARD_PERIOD_VALUES,
    description: '当前统计周期',
  })
  @IsString()
  period: (typeof PULSE_DASHBOARD_PERIOD_VALUES)[number];

  @ApiPropertyOptional({
    example: 1,
    description: '当前统计门店 ID，汇总模式时为空',
  })
  @IsOptional()
  @IsInt()
  storeId: number | null;

  @ApiProperty({ example: 3, description: '参与统计的门店数量' })
  @IsInt()
  storeCount: number;

  @ApiProperty({
    example: 1747180800000,
    description: '当前周期开始时间戳（ms）',
  })
  @IsInt()
  startAt: number;

  @ApiProperty({
    example: 1747212600000,
    description: '当前周期结束时间戳（ms）',
  })
  @IsInt()
  endAt: number;

  @ApiProperty({ example: 1747212600000, description: '接口生成时间戳（ms）' })
  @IsInt()
  generatedAt: number;
}

export class PulseDashboardOverviewResponseDto {
  @ApiProperty({
    type: PulseDashboardStatsDto,
    description: '跨店经营统计卡',
  })
  @ValidateNested()
  @Type(() => PulseDashboardStatsDto)
  stats: PulseDashboardStatsDto;

  @ApiProperty({
    type: PulseDashboardSalesTrendDto,
    description: '跨店销售趋势图数据',
  })
  @ValidateNested()
  @Type(() => PulseDashboardSalesTrendDto)
  salesTrend: PulseDashboardSalesTrendDto;

  @ApiProperty({
    type: PulseDashboardMetaDto,
    description: '返回元信息',
  })
  @ValidateNested()
  @Type(() => PulseDashboardMetaDto)
  meta: PulseDashboardMetaDto;
}

export class PulseDashboardStoreRankItemDto {
  @ApiProperty({ example: 1, description: '门店 ID' })
  @IsInt()
  storeId: number;

  @ApiProperty({ example: '纯利宝测试门店', description: '门店名称' })
  @IsString()
  storeName: string;

  @ApiPropertyOptional({ example: '北京市朝阳区', description: '门店地址' })
  @IsOptional()
  @IsString()
  address: string | null;

  @ApiProperty({ example: 1248.5, description: '当前周期净利润，单位元' })
  @IsNumber()
  profit: number;

  @ApiProperty({ example: 3200.0, description: '当前周期总收入，单位元' })
  @IsNumber()
  revenue: number;

  @ApiProperty({ example: 1951.5, description: '当前周期总成本，单位元' })
  @IsNumber()
  totalCost: number;

  @ApiProperty({ example: 86, description: '当前周期订单数' })
  @IsInt()
  orderCount: number;

  @ApiProperty({ example: 39.02, description: '净利润率（%）' })
  @IsNumber()
  profitRate: number;

  @ApiProperty({ example: 1, description: '利润排名（从 1 开始）' })
  @IsInt()
  rank: number;
}

export class PulseDashboardStoresResponseDto {
  @ApiProperty({
    type: PulseDashboardMetaDto,
    description: '返回元信息',
  })
  @ValidateNested()
  @Type(() => PulseDashboardMetaDto)
  meta: PulseDashboardMetaDto;

  @ApiProperty({
    type: [PulseDashboardStoreRankItemDto],
    description: '门店经营排行列表，按净利润从高到低',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseDashboardStoreRankItemDto)
  stores: PulseDashboardStoreRankItemDto[];
}
