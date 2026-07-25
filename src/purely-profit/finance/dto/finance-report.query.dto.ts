import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { transformOptionalBoolean } from '../../stores/dto/store-response.dto';
import {
  FINANCE_REPORT_PERIOD_VALUES,
  type FinanceReportPeriodValue,
} from '../finance.types';

export class FinanceReportQueryDto {
  @ApiPropertyOptional({
    enum: FINANCE_REPORT_PERIOD_VALUES,
    description: '报表中心财务周期筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_REPORT_PERIOD_VALUES, {
    message: '财务报表周期不合法',
  })
  period?: FinanceReportPeriodValue;

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

  @ApiPropertyOptional({
    enum: ['json', 'csv'],
    description: '导出格式，默认 json；csv 时服务端直接流式返回 CSV 文件',
  })
  @IsOptional()
  @IsIn(['json', 'csv'], { message: 'format 只支持 json 或 csv' })
  format?: 'json' | 'csv';
}
