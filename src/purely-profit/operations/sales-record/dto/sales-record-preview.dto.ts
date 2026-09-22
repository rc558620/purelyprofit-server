import { ApiProperty } from '@nestjs/swagger';

// ---------------------------------------------------------------------------
// 销售订单预览（不落库，仅返回后端计算金额供前端展示）
// ---------------------------------------------------------------------------

export class PreviewSalesRecordItemDto {
  @ApiProperty({ example: '1', description: '商品 ID' })
  productId: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  productName: string;

  @ApiProperty({ example: '饮品', description: '商品分类' })
  categoryName: string;

  @ApiProperty({ example: 6.5, description: '销售单价（元）' })
  salePrice: number;

  @ApiProperty({ example: 2.5, description: '单件利润（元）' })
  profit: number;

  @ApiProperty({ example: 2, description: '销售数量' })
  quantity: number;

  @ApiProperty({
    example: 13.0,
    description: '营业额小计（salePrice × quantity，由后端计算）',
  })
  revenueSubtotal: number;

  @ApiProperty({
    example: 5.0,
    description: '利润小计（profit × quantity，由后端计算）',
  })
  profitSubtotal: number;
}

export class PreviewSalesRecordResponseDto {
  @ApiProperty({
    type: [PreviewSalesRecordItemDto],
    description: '商品明细（含后端计算小计）',
  })
  items: PreviewSalesRecordItemDto[];

  @ApiProperty({
    example: 88.5,
    description: '总营业额（元，由后端根据明细重算）',
  })
  totalRevenue: number;

  @ApiProperty({
    example: 23.6,
    description: '总利润（元，由后端根据明细重算）',
  })
  totalProfit: number;

  @ApiProperty({ example: 8, description: '总销售件数（由后端根据明细重算）' })
  totalQuantity: number;
}
