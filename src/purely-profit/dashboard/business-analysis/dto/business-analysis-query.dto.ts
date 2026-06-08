import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import {
  transformOptionalBoolean,
  transformOptionalInt,
} from '../../../stores/dto/store-response.dto';
import {
  BUSINESS_ANALYSIS_PERIOD_VALUES,
  type BusinessAnalysisPeriod,
} from '../business-analysis.types';

export { BUSINESS_ANALYSIS_PERIOD_VALUES } from '../business-analysis.types';
export type { BusinessAnalysisPeriod } from '../business-analysis.types';

type LegacyBusinessAnalysisPeriodContext = Partial<{
  startTime: number | string;
  endTime: number | string;
}>;

function normalizeBusinessAnalysisPeriodInput({
  value,
  obj,
}: TransformFnParams): unknown {
  if (value !== 'all') {
    return value;
  }

  const query = obj as LegacyBusinessAnalysisPeriodContext | undefined;
  if (query?.startTime === undefined || query?.endTime === undefined) {
    return value;
  }

  return 'custom_range';
}

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
    description:
      '统计周期；自定义周期时需额外传 startTime/endTime，兼容旧版 all + 时间范围入参',
  })
  @Transform(normalizeBusinessAnalysisPeriodInput)
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

  @ApiPropertyOptional({
    example: false,
    description: '是否按导出模式拉取数据',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: '导出标记必须是布尔值' })
  export?: boolean;
}
