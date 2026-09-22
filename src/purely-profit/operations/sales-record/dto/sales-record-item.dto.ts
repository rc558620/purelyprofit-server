import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SalesProductResponseDto {
  @ApiProperty({ example: '1', description: '商品 ID' })
  id: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  name: string;

  @ApiProperty({ example: '饮品', description: '商品分类' })
  category: string;

  @ApiProperty({ example: 'COLA001', description: '商品编号' })
  code: string;

  @ApiProperty({ example: 2.5, description: '单件利润（对应前端 price）' })
  price: number;

  @ApiProperty({ example: 6.5, description: '销售单价（对应前端 salePrice）' })
  salePrice: number;

  @ApiProperty({ example: 0, description: '当前追加数量，固定返回 0' })
  quantity: number;
}

export class SalesRecordItemResponseDto {
  @ApiProperty({
    example: '1',
    description: '商品 ID；手动录单为生成的字符串 ID',
  })
  productId: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称快照' })
  productName: string;

  @ApiProperty({ example: '饮品', description: '商品分类快照' })
  categoryName: string;

  @ApiProperty({ example: 6.5, description: '销售单价（元）' })
  salePrice: number;

  @ApiProperty({ example: 2.5, description: '单件利润（元）' })
  profit: number;

  @ApiProperty({ example: 2, description: '销售数量' })
  quantity: number;

  @ApiProperty({
    example: 13,
    description: '商品小计 = salePrice × quantity（元）',
  })
  subtotal: number;

  @ApiPropertyOptional({
    example: ['不辣', '加鱼丸'],
    description: '商品规格名称快照；仅扫码点餐订单返回，普通订单缺省',
  })
  specs?: string[];

  @ApiPropertyOptional({
    example: 98,
    description:
      '优惠前单价（元，未扣任何优惠）；仅扫码点餐订单返回，普通订单缺省',
  })
  originalUnitPrice?: number;
}
