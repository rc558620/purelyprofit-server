import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaginationMetaDto,
} from '../../../stores/dto/store-response.dto';
import { ProductSpecGroupDto } from './product-spec.dto';

export class ProductResponseDto {
  @ApiProperty({ example: '1', description: '商品 ID' })
  id: string;

  @ApiProperty({ example: 18, description: '所属门店 ID' })
  storeId: number;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  name: string;

  @ApiProperty({ example: '饮品', description: '分类名称' })
  category: string;

  @ApiProperty({ example: 'COLA001', description: '商品编号' })
  code: string;

  @ApiProperty({ example: 6.5, description: '售价（元）' })
  price: number;

  @ApiProperty({
    example: 2.5,
    description: '单件利润（元），由服务端按售价−成本价派生',
  })
  profit: number;

  @ApiProperty({
    example: 38.5,
    description: '利润率（%），由服务端按利润/售价派生',
  })
  profitRate: number;

  @ApiPropertyOptional({ example: 4, description: '成本价（元）' })
  costPrice?: number;

  @ApiProperty({ example: '瓶', description: '单位' })
  unit: string;

  @ApiProperty({ example: 20, description: '当前库存' })
  stock: number;

  @ApiProperty({ example: 10, description: '库存预警阈值' })
  alertThreshold: number;

  @ApiPropertyOptional({
    example: 'https://example.com/coke.jpg',
    description: '商品图片',
  })
  image?: string;

  @ApiPropertyOptional({ example: '冰镇口感更佳', description: '商品描述' })
  description?: string;

  @ApiProperty({ example: true, description: '是否上架' })
  isActive: boolean;

  @ApiPropertyOptional({
    example: false,
    description: '是否上架到扫码点餐（仅餐饮门店有意义）',
  })
  scanOrderingEnabled?: boolean;

  @ApiPropertyOptional({
    type: [ProductSpecGroupDto],
    description: '餐饮商品规格组',
  })
  specGroups?: ProductSpecGroupDto[];

  @ApiProperty({ example: 1715600000000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiProperty({ example: 1715603600000, description: '更新时间戳（毫秒）' })
  updatedAt: number;
}

export class PaginatedProductsResponseDto {
  @ApiProperty({ type: [ProductResponseDto], description: '商品列表' })
  items: ProductResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  meta: PaginationMetaDto;
}

export class ScanOrderingStatusResponseDto {
  @ApiProperty({ example: '1', description: '商品 ID' })
  id: string;

  @ApiProperty({ example: true, description: '是否已上架到扫码点餐' })
  scanOrderingEnabled: boolean;
}
