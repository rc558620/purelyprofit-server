import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { transformOptionalBoolean } from '../../stores/dto/store-response.dto';

export class FinanceReportQueryDto {
  @ApiPropertyOptional({
    enum: [
      'today',
      'week',
      'month',
      'quarter',
      'year',
      'custom_month',
      'custom_range',
    ],
    description: '报表中心财务周期筛选',
  })
  @IsOptional()
  @IsIn(
    [
      'today',
      'week',
      'month',
      'quarter',
      'year',
      'custom_month',
      'custom_range',
    ],
    {
      message: '财务报表周期不合法',
    },
  )
  period?:
    | 'today'
    | 'week'
    | 'month'
    | 'quarter'
    | 'year'
    | 'custom_month'
    | 'custom_range';

  @ApiPropertyOptional({
    example: 2026,
    description: '按年筛选时的年份；不传默认当前年',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '年份必须是整数' })
  @Min(1970, { message: '年份不合法' })
  year?: number;

  @ApiPropertyOptional({
    example: 1747180800000,
    description: '按月模式对应的单日时间戳（ms）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义日期必须是整数时间戳' })
  @Min(0, { message: '自定义日期不合法' })
  customDate?: number;

  @ApiPropertyOptional({
    example: 1746057600000,
    description: '自定义区间开始时间戳（ms）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '区间开始时间必须是整数时间戳' })
  @Min(0, { message: '区间开始时间不合法' })
  rangeStartDate?: number;

  @ApiPropertyOptional({
    example: 1748735999999,
    description: '自定义区间结束时间戳（ms）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '区间结束时间必须是整数时间戳' })
  @Min(0, { message: '区间结束时间不合法' })
  rangeEndDate?: number;

  @ApiPropertyOptional({
    example: false,
    description: '是否按导出模式拉取数据',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: '导出标记必须是布尔值' })
  export?: boolean;
}
