import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PaginationMetaDto,
  PaginationQueryDto,
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../../stores/dto/store-response.dto';
import { PRODUCT_SORT_VALUES } from '../../../commerce/commerce.utils';

function transformOptionalBoolean({
  value,
}: {
  value: unknown;
}): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }
  return undefined;
}

export class ListProductsQueryDto extends PaginationQueryDto {
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

  @ApiPropertyOptional({ example: true, description: '是否只看上架商品' })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;

  @ApiPropertyOptional({
    example: 'createdAt',
    enum: PRODUCT_SORT_VALUES,
    description: '排序方式',
  })
  @IsOptional()
  @IsIn(PRODUCT_SORT_VALUES, { message: '排序方式不合法' })
  sortBy?: (typeof PRODUCT_SORT_VALUES)[number];
}

export class CreateProductDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  @IsString({ message: '商品名称必须是字符串' })
  @MinLength(1, { message: '商品名称不能为空' })
  @MaxLength(100, { message: '商品名称最长 100 个字符' })
  name: string;

  @ApiProperty({ example: '饮品', description: '分类名称' })
  @IsString({ message: '商品分类必须是字符串' })
  @MinLength(1, { message: '商品分类不能为空' })
  @MaxLength(30, { message: '商品分类最长 30 个字符' })
  category: string;

  @ApiPropertyOptional({
    example: 'COLA001',
    description: '商品编号，不传自动生成',
  })
  @IsOptional()
  @IsString({ message: '商品编号必须是字符串' })
  @MaxLength(50, { message: '商品编号最长 50 个字符' })
  code?: string;

  @ApiProperty({ example: 6.5, description: '售价（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '售价必须是数字' })
  @Min(0.01, { message: '售价必须大于 0' })
  price: number;

  @ApiPropertyOptional({ example: 4, description: '成本价（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '成本价必须是数字' })
  @Min(0, { message: '成本价不能为负数' })
  costPrice?: number;

  @ApiProperty({ example: '瓶', description: '单位' })
  @IsString({ message: '商品单位必须是字符串' })
  @MinLength(1, { message: '商品单位不能为空' })
  @MaxLength(20, { message: '商品单位最长 20 个字符' })
  unit: string;

  @ApiPropertyOptional({ example: 20, description: '初始库存' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '库存必须是整数' })
  @Min(0, { message: '库存不能为负数' })
  stock?: number;

  @ApiPropertyOptional({ example: 10, description: '库存预警阈值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '库存预警阈值必须是整数' })
  @Min(0, { message: '库存预警阈值不能为负数' })
  alertThreshold?: number;

  @ApiPropertyOptional({
    example: 'https://example.com/coke.jpg',
    description: '商品图片',
  })
  @IsOptional()
  @IsString({ message: '商品图片必须是字符串' })
  image?: string;

  @ApiPropertyOptional({ example: '冰镇口感更佳', description: '商品描述' })
  @IsOptional()
  @IsString({ message: '商品描述必须是字符串' })
  @MaxLength(500, { message: '商品描述最长 500 个字符' })
  description?: string;
}

export class UpdateProductDto {
  @ApiPropertyOptional({ example: '可口可乐 330ml', description: '商品名称' })
  @IsOptional()
  @IsString({ message: '商品名称必须是字符串' })
  @MinLength(1, { message: '商品名称不能为空' })
  @MaxLength(100, { message: '商品名称最长 100 个字符' })
  name?: string;

  @ApiPropertyOptional({ example: '饮品', description: '分类名称' })
  @IsOptional()
  @IsString({ message: '商品分类必须是字符串' })
  @MinLength(1, { message: '商品分类不能为空' })
  @MaxLength(30, { message: '商品分类最长 30 个字符' })
  category?: string;

  @ApiPropertyOptional({ example: 'COLA001', description: '商品编号' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '商品编号必须是字符串' })
  @MinLength(1, { message: '商品编号不能为空' })
  @MaxLength(50, { message: '商品编号最长 50 个字符' })
  code?: string;

  @ApiPropertyOptional({ example: 6.5, description: '售价（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '售价必须是数字' })
  @Min(0.01, { message: '售价必须大于 0' })
  price?: number;

  @ApiPropertyOptional({ example: 4, description: '成本价（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '成本价必须是数字' })
  @Min(0, { message: '成本价不能为负数' })
  costPrice?: number;

  @ApiPropertyOptional({ example: '瓶', description: '单位' })
  @IsOptional()
  @IsString({ message: '商品单位必须是字符串' })
  @MinLength(1, { message: '商品单位不能为空' })
  @MaxLength(20, { message: '商品单位最长 20 个字符' })
  unit?: string;

  @ApiPropertyOptional({ example: 20, description: '库存' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '库存必须是整数' })
  @Min(0, { message: '库存不能为负数' })
  stock?: number;

  @ApiPropertyOptional({ example: 10, description: '库存预警阈值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '库存预警阈值必须是整数' })
  @Min(0, { message: '库存预警阈值不能为负数' })
  alertThreshold?: number;

  @ApiPropertyOptional({
    example: 'https://example.com/coke.jpg',
    description: '商品图片，空字符串表示清空',
  })
  @IsOptional()
  @IsString({ message: '商品图片必须是字符串' })
  image?: string;

  @ApiPropertyOptional({
    example: '冰镇口感更佳',
    description: '商品描述，空字符串表示清空',
  })
  @IsOptional()
  @IsString({ message: '商品描述必须是字符串' })
  @MaxLength(500, { message: '商品描述最长 500 个字符' })
  description?: string;

  @ApiPropertyOptional({ example: true, description: '是否上架' })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;
}

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

  @ApiProperty({ example: 2.5, description: '单件利润（元），由服务端按售价−成本价派生' })
  profit: number;

  @ApiProperty({ example: 38.5, description: '利润率（%），由服务端按利润/售价派生' })
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
