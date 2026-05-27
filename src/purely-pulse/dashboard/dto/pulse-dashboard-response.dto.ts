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

// ─────────────────────────────────────────────────────────────
// 总览 - 统计卡
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// 总览 - 销售趋势
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// 总览 - 元信息
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// 总览 - 完整响应
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// 门店排行
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Home 页 — 在线人数卡
// 对齐前端 home.tsx 中的 ONLINE_COUNT / ONLINE_PEAK / ONLINE_TREND
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Home 页 — 合伙人快览统计卡
// 对齐前端 home.tsx 中的 PARTNER_STATS
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Home 页 — 合伙人排行 TOP5 条目
// 对齐前端 home.tsx 中的 PARTNER_TOP 数组元素
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Home 页 — 充值收入趋势
// 对齐前端 home.tsx 中的 REVENUE_DATA[RevenuePeriod]
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Home 页 — 充值收入汇总
// 对齐前端 home.tsx 中的 REVENUE_SUMMARY[RevenuePeriod]
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Home 页 — 充值类型分布条目
// 对齐前端 home.tsx 中的 revenueTypeGrid 数据
// ─────────────────────────────────────────────────────────────

export class PulseDashboardRevenueTypeItemDto {
  @ApiProperty({ example: '月卡会员', description: '充值类型名称' })
  @IsString()
  label: string;

  @ApiProperty({ example: 48, description: '占比（整数百分比）' })
  @IsInt()
  value: number;
}

export class PulseRevenueDetailRecordDto {
  @ApiProperty({ example: 'order-21', description: '充值记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '刘梅', description: '充值用户展示名' })
  @IsString()
  user: string;

  @ApiProperty({ example: '季度会员', description: '充值类型' })
  @IsString()
  type: string;

  @ApiProperty({ example: 9900, description: '充值金额（分）' })
  @IsInt()
  amount: number;

  @ApiProperty({ example: '310000 · 310100 · 310104', description: '地区文案' })
  @IsString()
  region: string;

  @ApiProperty({ example: '09:30', description: '充值时间（HH:mm）' })
  @IsString()
  time: string;
}

export class PulseRevenueDetailResponseDto {
  @ApiProperty({
    type: PulseDashboardRevenueTrendDto,
    description: '充值收入趋势数据',
  })
  @ValidateNested()
  @Type(() => PulseDashboardRevenueTrendDto)
  revenueTrend: PulseDashboardRevenueTrendDto;

  @ApiProperty({
    type: PulseDashboardRevenueSummaryDto,
    description: '充值收入汇总数据',
  })
  @ValidateNested()
  @Type(() => PulseDashboardRevenueSummaryDto)
  revenueSummary: PulseDashboardRevenueSummaryDto;

  @ApiProperty({
    type: [PulseDashboardRevenueTypeItemDto],
    description: '充值类型占比',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseDashboardRevenueTypeItemDto)
  revenueTypeBreakdown: PulseDashboardRevenueTypeItemDto[];

  @ApiProperty({
    type: [PulseRevenueDetailRecordDto],
    description: '充值记录列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseRevenueDetailRecordDto)
  records: PulseRevenueDetailRecordDto[];

  @ApiProperty({ example: 28, description: '充值记录总数' })
  @IsInt()
  totalRecords: number;

  @ApiProperty({ example: 1747212600000, description: '接口生成时间戳（ms）' })
  @IsInt()
  generatedAt: number;
}

// ─────────────────────────────────────────────────────────────
// Home 页 — 完整响应
// GET /pulse/dashboard/home
// ─────────────────────────────────────────────────────────────

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
