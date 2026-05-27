import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import {
  transformOptionalBoolean,
  transformOptionalInt,
} from '../../../stores/dto/store-response.dto';
import {
  PROFIT_DETAIL_PERIOD_VALUES,
  type ProfitDetailPeriodValue,
} from '../profit-detail.types';

export class GetProfitDetailQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '门店 ID，不传默认当前登录门店',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    enum: PROFIT_DETAIL_PERIOD_VALUES,
    description: '利润详情时间周期，不传默认 month',
  })
  @IsOptional()
  @IsIn(PROFIT_DETAIL_PERIOD_VALUES, { message: '利润时间周期不合法' })
  period?: ProfitDetailPeriodValue;

  @ApiPropertyOptional({
    example: 2026,
    description: '按年筛选时的年份；不传默认当前年',
  })
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
    example: 1747008000000,
    description: '开始时间戳（毫秒），兼容前端 startTime 参数',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '开始时间必须是整数时间戳' })
  @Min(0, { message: '开始时间不合法' })
  startTime?: number;

  @ApiPropertyOptional({
    example: 1747526399999,
    description: '结束时间戳（毫秒），兼容前端 endTime 参数',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
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
