import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';

export const BUSINESS_ANALYSIS_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'quarter',
  'all',
  'custom_month',
  'custom_range',
] as const;

export type BusinessAnalysisPeriod = (typeof BUSINESS_ANALYSIS_PERIOD_VALUES)[number];

export class GetBusinessAnalysisQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '门店 ID，不传默认当前登录门店',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({
    enum: BUSINESS_ANALYSIS_PERIOD_VALUES,
    example: 'month',
    description: '统计周期；自定义周期时需额外传 startTime/endTime',
  })
  @IsIn(BUSINESS_ANALYSIS_PERIOD_VALUES, { message: '统计周期不合法' })
  period: BusinessAnalysisPeriod;

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
