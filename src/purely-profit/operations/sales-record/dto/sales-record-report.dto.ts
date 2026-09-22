import { ApiProperty } from '@nestjs/swagger';

export class SalesReportSummaryDto {
  @ApiProperty({ example: 56, description: '销售总数量' })
  totalQuantity: number;

  @ApiProperty({ example: 1280, description: '销售总收入' })
  totalRevenue: number;

  @ApiProperty({ example: 12, description: '销售明细条数' })
  orderCount: number;

  @ApiProperty({ example: 106.67, description: '平均单条销售额' })
  avgOrderValue: number;
}

export class SalesDailyRowDto {
  @ApiProperty({ example: '1715644800000-12', description: '聚合行 ID' })
  id: string;

  @ApiProperty({ example: '05/14', description: '日期标签' })
  dateLabel: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  productName: string;

  @ApiProperty({ example: 8, description: '销售数量' })
  quantity: number;

  @ApiProperty({ example: 52, description: '销售收入' })
  revenue: number;
}

export class SalesReportResponseDto {
  @ApiProperty({ type: SalesReportSummaryDto, description: '销售报表概况' })
  summary: SalesReportSummaryDto;

  @ApiProperty({ type: [SalesDailyRowDto], description: '按天聚合的销售明细' })
  dailySales: SalesDailyRowDto[];
}
