import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PaginationMetaDto,
  PaginationQueryDto,
  transformOptionalBoolean,
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../../stores/dto/store-response.dto';
import {
  INVENTORY_ADJUST_MODE_VALUES,
  INVENTORY_ADJUST_TYPE_VALUES,
  INVENTORY_STOCK_ALERT_LEVEL_VALUES,
  INVENTORY_STOCK_SORT_VALUES,
  type InventoryStockAlertLevelValue,
} from '../../../commerce/commerce.utils';

export class ListInventoryProductsQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({ example: '可乐', description: '商品名称或编号关键字' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '关键字必须是字符串' })
  keyword?: string;

  @ApiPropertyOptional({ example: '饮品', description: '分类名称' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '分类名称必须是字符串' })
  category?: string;

  @ApiPropertyOptional({ example: true, description: '是否只看预警商品' })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: 'alertOnly 必须是布尔值' })
  alertOnly?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: '是否按导出模式拉取数据',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: '导出标记必须是布尔值' })
  export?: boolean;

  @ApiPropertyOptional({
    enum: ['json', 'csv'],
    description: '导出格式，默认 json；csv 时服务端直接流式返回 CSV 文件',
  })
  @IsOptional()
  @IsIn(['json', 'csv'], { message: 'format 只支持 json 或 csv' })
  format?: 'json' | 'csv';

  @ApiPropertyOptional({
    example: 'warning',
    enum: INVENTORY_STOCK_ALERT_LEVEL_VALUES,
    description: '库存预警级别筛选',
  })
  @IsOptional()
  @IsIn(INVENTORY_STOCK_ALERT_LEVEL_VALUES, { message: '库存预警级别不合法' })
  alertLevel?: (typeof INVENTORY_STOCK_ALERT_LEVEL_VALUES)[number];

  @ApiPropertyOptional({
    example: 'alert',
    enum: INVENTORY_STOCK_SORT_VALUES,
    description: '排序方式',
  })
  @IsOptional()
  @IsIn(INVENTORY_STOCK_SORT_VALUES, { message: '排序方式不合法' })
  sortBy?: (typeof INVENTORY_STOCK_SORT_VALUES)[number];

  /* BUG-7: 添加分页参数，不传时默认返回全量（保持向后兼容） */
  @ApiPropertyOptional({ example: 1, description: '页码，不传则返回全量' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于等于 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: '每页数量，不传则返回全量' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '每页数量必须是整数' })
  @Min(1, { message: '每页数量必须大于等于 1' })
  pageSize?: number;
}

export class InventoryProductResponseDto {
  @ApiProperty({ example: '1', description: '商品 ID' })
  id: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  name: string;

  @ApiProperty({ example: '饮品', description: '分类名称' })
  category: string;

  @ApiProperty({ example: 'COLA001', description: '商品编号' })
  code: string;

  @ApiProperty({ example: 6.5, description: '售价（元）' })
  price: number;

  @ApiProperty({ example: 2.5, description: '单件利润（元）' })
  profit: number;

  @ApiPropertyOptional({ example: 4, description: '成本价（元）' })
  costPrice?: number;

  @ApiProperty({ example: '瓶', description: '单位' })
  unit: string;

  @ApiProperty({ example: 20, description: '当前库存' })
  stock: number;

  @ApiProperty({ example: 10, description: '库存预警阈值' })
  alertThreshold: number;

  @ApiProperty({
    example: 'warning',
    enum: INVENTORY_STOCK_ALERT_LEVEL_VALUES,
    description: '库存状态等级',
  })
  alertLevel: InventoryStockAlertLevelValue;

  @ApiPropertyOptional({
    example: 'https://example.com/coke.jpg',
    description: '商品图片',
  })
  image?: string;

  @ApiProperty({ example: 1715600000000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiProperty({ example: 1715603600000, description: '更新时间戳（毫秒）' })
  updatedAt: number;
}

export class PaginatedInventoryProductsResponseDto {
  @ApiProperty({
    type: [InventoryProductResponseDto],
    description: '库存商品列表',
  })
  items: InventoryProductResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  meta: PaginationMetaDto;
}

export class AdjustInventoryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ example: 1, description: '商品 ID' })
  @Type(() => Number)
  @IsInt({ message: '商品 ID 必须是整数' })
  @Min(1, { message: '商品 ID 必须大于等于 1' })
  productId: number;

  @ApiPropertyOptional({
    example: 5,
    description: '增减模式下的调整数量，可正可负；不传时默认为 0',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '调整数量必须是整数' })
  delta?: number;

  @ApiPropertyOptional({
    example: 'set',
    enum: INVENTORY_ADJUST_MODE_VALUES,
    description: '调整模式，set 表示直接设置盘点后库存',
  })
  @IsOptional()
  @IsIn(INVENTORY_ADJUST_MODE_VALUES, { message: '调整模式不合法' })
  mode?: (typeof INVENTORY_ADJUST_MODE_VALUES)[number];

  @ApiPropertyOptional({
    example: 30,
    description: 'set 模式下的目标库存',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '目标库存必须是整数' })
  @Min(0, { message: '目标库存不能为负数' })
  targetStock?: number;

  @ApiProperty({
    example: 'manual',
    enum: INVENTORY_ADJUST_TYPE_VALUES,
    description: '调整类型',
  })
  @IsIn(INVENTORY_ADJUST_TYPE_VALUES, { message: '调整类型不合法' })
  adjustType: (typeof INVENTORY_ADJUST_TYPE_VALUES)[number];

  @ApiPropertyOptional({ example: '盘点修正', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;
}

export class UpdateAlertThresholdDto {
  @ApiProperty({ example: 10, description: '库存预警阈值' })
  @Type(() => Number)
  @IsInt({ message: '库存预警阈值必须是整数' })
  @Min(0, { message: '库存预警阈值不能为负数' })
  threshold: number;
}

export class ListInventoryAdjustmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({ example: 1, description: '商品 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '商品 ID 必须是整数' })
  @Min(1, { message: '商品 ID 必须大于等于 1' })
  productId?: number;

  @ApiPropertyOptional({ example: '可乐', description: '商品关键字' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '关键字必须是字符串' })
  keyword?: string;

  @ApiPropertyOptional({
    example: 'restock',
    enum: INVENTORY_ADJUST_TYPE_VALUES,
    description: '调整类型',
  })
  @IsOptional()
  @IsIn(INVENTORY_ADJUST_TYPE_VALUES, { message: '调整类型不合法' })
  adjustType?: (typeof INVENTORY_ADJUST_TYPE_VALUES)[number];
}

export class InventoryAdjustmentResponseDto {
  @ApiProperty({ example: '1', description: '记录 ID' })
  id: string;

  @ApiProperty({ example: '1', description: '商品 ID' })
  productId: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称快照' })
  productName: string;

  @ApiProperty({ example: 10, description: '调整前库存' })
  beforeStock: number;

  @ApiProperty({ example: 15, description: '调整后库存' })
  afterStock: number;

  @ApiProperty({ example: 5, description: '变化量' })
  delta: number;

  @ApiProperty({
    example: 'restock',
    enum: INVENTORY_ADJUST_TYPE_VALUES,
    description: '调整类型',
  })
  adjustType: (typeof INVENTORY_ADJUST_TYPE_VALUES)[number];

  @ApiPropertyOptional({ example: '盘点修正', description: '备注' })
  note?: string;

  @ApiPropertyOptional({ example: '1', description: '关联进货单 ID' })
  purchaseOrderId?: string;

  @ApiProperty({ example: 1715600000000, description: '创建时间戳（毫秒）' })
  createdAt: number;
}

export class PaginatedInventoryAdjustmentsResponseDto {
  @ApiProperty({
    type: [InventoryAdjustmentResponseDto],
    description: '库存调整记录列表',
  })
  items: InventoryAdjustmentResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  meta: PaginationMetaDto;
}

export class InventoryStatsResponseDto {
  @ApiProperty({ example: 20, description: 'SKU 总数' })
  totalSkuCount: number;

  @ApiProperty({ example: 3, description: '预警商品数' })
  warningCount: number;

  @ApiProperty({ example: 1, description: '缺货商品数' })
  dangerCount: number;

  @ApiProperty({ example: 16, description: '库存正常商品数' })
  normalCount: number;

  @ApiProperty({ example: 12880, description: '库存总货值（元）' })
  totalStockValue: number;
}

export class InventoryReportResponseDto {
  @ApiProperty({ type: InventoryStatsResponseDto, description: '库存报表概况' })
  @ValidateNested()
  @Type(() => InventoryStatsResponseDto)
  summary: InventoryStatsResponseDto;

  @ApiProperty({
    type: [InventoryProductResponseDto],
    description: '商品库存明细',
  })
  @IsArray({ message: '商品库存明细必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => InventoryProductResponseDto)
  products: InventoryProductResponseDto[];
}

/* BUG-6: getStats 的 storeId 改用 DTO 校验，替代 Controller 层的 ParseIntPipe */
export class InventoryStatsQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}

export class ProductThresholdResponseDto {
  @ApiProperty({ example: '1', description: '商品 ID' })
  productId: string;

  @ApiProperty({ example: 10, description: '库存预警阈值' })
  alertThreshold: number;

  @ApiProperty({ example: 1715603600000, description: '更新时间戳（毫秒）' })
  updatedAt: number;
}
