import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SalesStatsResponseDto {
  @ApiProperty({ example: 1200.5, description: '当前筛选周期总营业额' })
  totalRevenue: number;

  @ApiProperty({ example: 320.2, description: '当前筛选周期总利润' })
  totalProfit: number;

  @ApiProperty({ example: 18, description: '当前筛选周期订单笔数' })
  orderCount: number;

  @ApiProperty({ example: 66.69, description: '平均客单价' })
  avgOrderValue: number;

  @ApiPropertyOptional({
    example: 12.5,
    description: '较上期营业额变化百分比；无对比数据时为 null',
  })
  compareLastPeriod: number | null;
}
