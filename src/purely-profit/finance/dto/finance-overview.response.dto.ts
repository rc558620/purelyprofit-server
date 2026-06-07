import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import {
  FinanceDailyTrendDto,
  FinanceHeroSummaryDto,
  FinanceSourceGroupDto,
} from './finance-shared.response.dto';

export class FinanceOverviewResponseDto {
  @ApiProperty({ type: FinanceHeroSummaryDto, description: '头部汇总卡' })
  @ValidateNested()
  @Type(() => FinanceHeroSummaryDto)
  heroSummary: FinanceHeroSummaryDto;

  @ApiProperty({ type: [FinanceDailyTrendDto], description: '每日趋势' })
  @IsArray({ message: '每日趋势必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceDailyTrendDto)
  dailyTrend: FinanceDailyTrendDto[];

  @ApiProperty({ type: FinanceSourceGroupDto, description: '收入构成' })
  @ValidateNested()
  @Type(() => FinanceSourceGroupDto)
  incomeGroup: FinanceSourceGroupDto;

  @ApiProperty({ type: FinanceSourceGroupDto, description: '支出构成' })
  @ValidateNested()
  @Type(() => FinanceSourceGroupDto)
  expenseGroup: FinanceSourceGroupDto;
}
