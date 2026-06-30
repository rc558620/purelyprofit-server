import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, ValidateNested } from 'class-validator';
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

  @ApiProperty({ type: [FinanceDailyTrendDto], description: '收支趋势（日聚合或月聚合）' })
  @IsArray({ message: '收支趋势必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceDailyTrendDto)
  dailyTrend: FinanceDailyTrendDto[];

  @ApiProperty({
    enum: ['daily', 'monthly'],
    description: '趋势聚合粒度：daily=按天，monthly=按月（year 周期）',
  })
  @IsIn(['daily', 'monthly'], { message: '趋势聚合粒度不合法' })
  trendGranularity: 'daily' | 'monthly';

  @ApiProperty({ type: FinanceSourceGroupDto, description: '收入构成' })
  @ValidateNested()
  @Type(() => FinanceSourceGroupDto)
  incomeGroup: FinanceSourceGroupDto;

  @ApiProperty({ type: FinanceSourceGroupDto, description: '支出构成' })
  @ValidateNested()
  @Type(() => FinanceSourceGroupDto)
  expenseGroup: FinanceSourceGroupDto;
}
