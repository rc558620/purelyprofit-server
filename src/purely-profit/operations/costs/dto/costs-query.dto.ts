import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import {
  COST_CATEGORY_VALUES,
  COST_PERIOD_VALUES,
  COST_REPORT_CATEGORY_FILTER_VALUES,
  COST_REPORT_PERIOD_VALUES,
  COST_TYPE_FILTER_VALUES,
  COST_TYPE_VALUES,
  type CostPeriodValue,
  type CostReportCategoryFilterValue,
  type CostReportPeriodValue,
  type CostTypeFilterValue,
} from '../costs.types';

export class ListCostRecordsQueryDto {
  @ApiPropertyOptional({
    enum: COST_PERIOD_VALUES,
    description: '成本记录时间周期筛选',
  })
  @IsOptional()
  @IsIn(COST_PERIOD_VALUES, { message: '成本时间周期不合法' })
  period?: CostPeriodValue;

  @ApiPropertyOptional({
    enum: COST_TYPE_FILTER_VALUES,
    description: '成本类型筛选',
  })
  @IsOptional()
  @IsIn(COST_TYPE_FILTER_VALUES, { message: '成本类型筛选不合法' })
  typeFilter?: CostTypeFilterValue;

  @ApiPropertyOptional({
    example: 1747180800000,
    description: '自定义单日时间戳（毫秒，对应 custom_month）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '自定义日期必须是整数时间戳' })
  @Min(0, { message: '自定义日期不合法' })
  customDate?: number;

  @ApiPropertyOptional({
    example: 1747008000000,
    description: '自定义区间开始时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间开始时间必须是整数时间戳' })
  @Min(0, { message: '区间开始时间不合法' })
  rangeStartDate?: number;

  @ApiPropertyOptional({
    example: 1747526399999,
    description: '自定义区间结束时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间结束时间必须是整数时间戳' })
  @Min(0, { message: '区间结束时间不合法' })
  rangeEndDate?: number;
}

export class CostRecordStatsQueryDto extends ListCostRecordsQueryDto {}

export class CostReportQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    enum: COST_REPORT_PERIOD_VALUES,
    description: '报表中心成本周期筛选',
  })
  @IsOptional()
  @IsIn(COST_REPORT_PERIOD_VALUES, { message: '成本报表周期不合法' })
  period?: CostReportPeriodValue;

  @ApiPropertyOptional({ example: 2026, description: '按年筛选时的年份；不传默认当前年' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '年份必须是整数' })
  @Min(1970, { message: '年份不合法' })
  year?: number;

  @ApiPropertyOptional({
    example: 1747180800000,
    description: '自定义单日时间戳（毫秒，对应 custom_month）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '自定义日期必须是整数时间戳' })
  @Min(0, { message: '自定义日期不合法' })
  customDate?: number;

  @ApiPropertyOptional({
    example: 1747008000000,
    description: '自定义区间开始时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间开始时间必须是整数时间戳' })
  @Min(0, { message: '区间开始时间不合法' })
  rangeStartDate?: number;

  @ApiPropertyOptional({
    example: 1747526399999,
    description: '自定义区间结束时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间结束时间必须是整数时间戳' })
  @Min(0, { message: '区间结束时间不合法' })
  rangeEndDate?: number;

  @ApiPropertyOptional({
    enum: COST_REPORT_CATEGORY_FILTER_VALUES,
    description: '报表中心成本分类筛选；all 返回汇总视图，salary 会额外合并工资草稿',
  })
  @IsOptional()
  @IsIn(COST_REPORT_CATEGORY_FILTER_VALUES, { message: '成本分类筛选不合法' })
  categoryFilter?: CostReportCategoryFilterValue;
}

export class CreateCostRecordDto {
  @ApiProperty({ example: '门店房租', description: '成本名称' })
  @IsString({ message: '成本名称必须是字符串' })
  @MaxLength(30, { message: '成本名称最多 30 个字符' })
  title: string;

  @ApiProperty({ enum: COST_TYPE_VALUES, description: '成本类型' })
  @IsIn(COST_TYPE_VALUES, { message: '成本类型不合法' })
  type: 'fixed' | 'variable';

  @ApiProperty({
    enum: COST_CATEGORY_VALUES,
    description: '成本分类',
  })
  @IsIn(COST_CATEGORY_VALUES, { message: '成本分类不合法' })
  category:
    | 'rent'
    | 'salary'
    | 'insurance'
    | 'provident_fund'
    | 'utilities'
    | 'purchase'
    | 'equipment'
    | 'marketing'
    | 'packaging'
    | 'other';

  @ApiProperty({ example: 1888.5, description: '金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '成本金额必须是数字' })
  @Min(0.01, { message: '成本金额必须大于 0' })
  amount: number;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（毫秒）' })
  @Transform(transformOptionalInt)
  @IsInt({ message: '发生时间必须是整数时间戳' })
  @Min(0, { message: '发生时间不合法' })
  date: number;

  @ApiPropertyOptional({ example: '每月固定房租', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 个字符' })
  note?: string;
}
