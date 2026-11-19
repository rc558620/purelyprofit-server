import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import {
  DASHBOARD_HOME_PERIOD_VALUES,
  normalizeDashboardHomePeriod,
  type DashboardHomePeriodValue,
} from '../dashboard-home.types';

export class GetDashboardHomeOverviewQueryDto {
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
    enum: DASHBOARD_HOME_PERIOD_VALUES,
    description:
      '首页概览时间周期，不传默认今日；兼容 today/week/month/year/last_year',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    /*
     * 已知写法（today/week/... 与历史中文别名）归一化为标准枚举；
     * 无法识别时保留原值交给 @IsIn 拒绝，避免此前「非法值被转成 undefined、
     * 又被 @IsOptional 跳过校验、最终静默按今日返回」的降级行为。
     */
    return normalizeDashboardHomePeriod(trimmed) ?? trimmed;
  })
  @IsIn(DASHBOARD_HOME_PERIOD_VALUES, { message: '首页时间周期不合法' })
  period?: DashboardHomePeriodValue;
}
