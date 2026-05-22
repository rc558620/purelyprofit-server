import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { transformOptionalInt } from '../../../purely-profit/stores/dto/store-response.dto';
import {
  BUSINESS_ANALYSIS_PERIOD_VALUES,
  type BusinessAnalysisPeriod,
} from '../../../purely-profit/dashboard/business-analysis/dto/business-analysis-query.dto';

// ─────────────────────────────────────────────────────────────
// 总览时间周期枚举（Pulse 目标门店视角用 today/week/month/year）
// ─────────────────────────────────────────────────────────────

export const PULSE_DASHBOARD_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'year',
] as const;

export type PulseDashboardPeriodValue =
  (typeof PULSE_DASHBOARD_PERIOD_VALUES)[number];

// ─────────────────────────────────────────────────────────────
// Query DTOs
// ─────────────────────────────────────────────────────────────

/**
 * GET /pulse/dashboard/overview
 * 跨店经营总览查询参数
 */
export class GetPulseDashboardOverviewQueryDto {
  @ApiPropertyOptional({
    enum: PULSE_DASHBOARD_PERIOD_VALUES,
    example: 'today',
    description: '统计周期，不传默认今日',
  })
  @IsOptional()
  @IsIn(PULSE_DASHBOARD_PERIOD_VALUES, { message: '统计周期不合法' })
  period?: PulseDashboardPeriodValue;

  @ApiPropertyOptional({
    example: 1,
    description: '目标门店 ID，不传时使用当前已选中的目标门店',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}

/**
 * GET /pulse/dashboard/stores
 * 门店经营排行查询参数
 */
export class GetPulseDashboardStoresQueryDto {
  @ApiPropertyOptional({
    enum: PULSE_DASHBOARD_PERIOD_VALUES,
    example: 'month',
    description: '统计周期，不传默认本月',
  })
  @IsOptional()
  @IsIn(PULSE_DASHBOARD_PERIOD_VALUES, { message: '统计周期不合法' })
  period?: PulseDashboardPeriodValue;

  @ApiPropertyOptional({
    example: 1,
    description: '目标门店 ID，不传时使用当前已选中的目标门店',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}

/**
 * GET /pulse/dashboard/analysis
 * 经营分析（复用 BusinessAnalysis 参数，但 storeId 表示目标门店）
 */
export class GetPulseDashboardAnalysisQueryDto {
  @ApiPropertyOptional({
    enum: BUSINESS_ANALYSIS_PERIOD_VALUES,
    example: 'month',
    description: '统计周期',
  })
  @IsOptional()
  @IsIn(BUSINESS_ANALYSIS_PERIOD_VALUES, { message: '统计周期不合法' })
  period?: BusinessAnalysisPeriod;

  @ApiPropertyOptional({
    example: 1,
    description: '目标门店 ID，不传时使用当前已选中的目标门店',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    example: 1746057600000,
    description: '自定义周期开始时间戳（毫秒）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '开始时间必须是整数时间戳' })
  @Min(0, { message: '开始时间不合法' })
  startTime?: number;

  @ApiPropertyOptional({
    example: 1748735999999,
    description: '自定义周期结束时间戳（毫秒）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '结束时间必须是整数时间戳' })
  @Min(0, { message: '结束时间不合法' })
  endTime?: number;
}

// ─────────────────────────────────────────────────────────────
// Home 页充值收入时间周期枚举
// 对齐前端 home.tsx 中的 RevenuePeriod
// ─────────────────────────────────────────────────────────────

export const PULSE_HOME_REVENUE_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'season',
] as const;
export type PulseHomeRevenuePeriodValue =
  (typeof PULSE_HOME_REVENUE_PERIOD_VALUES)[number];

/**
 * GET /pulse/dashboard/home
 * Home 页聚合数据查询参数
 */
export class GetPulseDashboardHomeQueryDto {
  @ApiPropertyOptional({
    enum: PULSE_HOME_REVENUE_PERIOD_VALUES,
    example: 'month',
    description:
      '充值收入图表统计周期（today=今日 / week=本周 / month=本月 / season=本季），不传默认 month',
  })
  @IsOptional()
  @IsIn(PULSE_HOME_REVENUE_PERIOD_VALUES, { message: '收入统计周期不合法' })
  revenuePeriod?: PulseHomeRevenuePeriodValue;

  @ApiPropertyOptional({
    example: '上海市',
    description: '合伙人排行地区筛选（省 / 市名），不传返回全国',
  })
  @IsOptional()
  @IsString({ message: '地区筛选必须是字符串' })
  region?: string;
}

export class GetPulseRevenueDetailQueryDto {
  @ApiPropertyOptional({
    enum: PULSE_HOME_REVENUE_PERIOD_VALUES,
    example: 'month',
    description: '充值收入明细统计周期（today / week / month / season）',
  })
  @IsOptional()
  @IsIn(PULSE_HOME_REVENUE_PERIOD_VALUES, { message: '收入统计周期不合法' })
  period?: PulseHomeRevenuePeriodValue;

  @ApiPropertyOptional({
    example: '2026/05/21',
    description: '自定义单日，格式 yyyy/MM/dd',
  })
  @IsOptional()
  @IsString({ message: '自定义日期必须是字符串' })
  date?: string;

  @ApiPropertyOptional({
    example: '2026/05/01',
    description: '自定义区间开始日期，格式 yyyy/MM/dd',
  })
  @IsOptional()
  @IsString({ message: '开始日期必须是字符串' })
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026/05/21',
    description: '自定义区间结束日期，格式 yyyy/MM/dd',
  })
  @IsOptional()
  @IsString({ message: '结束日期必须是字符串' })
  endDate?: string;

  @ApiPropertyOptional({
    example: '310000,310100,310104',
    description: '地区级联值，逗号分隔',
  })
  @IsOptional()
  @IsString({ message: '地区筛选值必须是字符串' })
  regionValues?: string;

  @ApiPropertyOptional({ example: '310104', description: '地区编码' })
  @IsOptional()
  @IsString({ message: '地区编码必须是字符串' })
  regionCode?: string;

  @ApiPropertyOptional({ example: '310000', description: '省编码' })
  @IsOptional()
  @IsString({ message: '省编码必须是字符串' })
  provinceCode?: string;

  @ApiPropertyOptional({ example: '310100', description: '市编码' })
  @IsOptional()
  @IsString({ message: '市编码必须是字符串' })
  cityCode?: string;

  @ApiPropertyOptional({ example: '310104', description: '区编码' })
  @IsOptional()
  @IsString({ message: '区编码必须是字符串' })
  districtCode?: string;
}
