import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  FINANCE_OVERVIEW_PERIOD_VALUES,
  type FinanceOverviewPeriodValue,
} from '../finance.types';

export class FinanceOverviewQueryDto {
  @ApiPropertyOptional({
    enum: FINANCE_OVERVIEW_PERIOD_VALUES,
    description: '财务总览周期筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_OVERVIEW_PERIOD_VALUES, { message: '财务周期不合法' })
  period?: FinanceOverviewPeriodValue;
}
