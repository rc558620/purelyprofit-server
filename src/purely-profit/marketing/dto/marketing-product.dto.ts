import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TransformFnParams } from 'class-transformer';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const MARKETING_PRODUCT_IMAGE_MAX_LENGTH = 300000;

/** 严格整数转换：仅接受干净整数串，拒绝浮点（B-4 fix） */
function transformRequiredInt({ value }: TransformFnParams): number | string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
    return value; // 非干净整数串，留给 @IsInt 报错
  }
  return String(value);
}

/** 可清空整数转换：null/'' → null（B-1 fix，清空语义） */
function transformNullableInt({
  value,
}: TransformFnParams): number | null | string | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
    return value;
  }
  return String(value);
}

/** 可空元金额转换：null/'' → null（清空语义），number 原样透传 */
function transformNullableYuan({
  value,
}: TransformFnParams): number | null | string | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return String(value);
}

/** B-3 fix: 字符串 trim，让 MinLength/MaxLength 在 trim 后校验 */
function trimString({ value }: TransformFnParams): string | undefined {
  if (typeof value === 'string') return value.trim();
  return value;
}
import {
  MARKETING_PRODUCT_SORT_VALUES,
  type MarketingProductSortValue,
} from '../marketing.utils';
import { MarketingPageQueryDto } from './marketing-pagination-query.dto';

export class ListMarketingProductsQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({ example: 1, description: '分类 ID（不传则查全部）' })
  @IsOptional()
  @Transform(transformNullableInt)
  @ValidateIf((o: ListMarketingProductsQueryDto) => o.categoryId != null)
  @IsInt({ message: '分类 ID 必须是整数' })
  @Min(1, { message: '分类 ID 必须大于等于 1' })
  categoryId?: number | null;

  @ApiPropertyOptional({
    example: 'createdAt',
    enum: MARKETING_PRODUCT_SORT_VALUES,
    description:
      '排序方式（createdAt=最新 name=名称 price_asc=价格升序 price_desc=价格降序）',
  })
  @IsOptional()
  @IsIn(MARKETING_PRODUCT_SORT_VALUES, { message: '无效的产品排序方式' })
  sortBy?: MarketingProductSortValue;
}

export class CreateMarketingProductCategoryDto {
  @ApiProperty({ example: '推拿按摩', description: '分类名称' })
  @IsString({ message: '分类名称必须是字符串' })
  @Transform(trimString)
  @MinLength(1, { message: '分类名称不能为空' })
  @MaxLength(20, { message: '分类名称最长 20 个字符' })
  name: string;

  @ApiPropertyOptional({
    example: '💆',
    description: '分类图标（emoji 或图片 URL）',
  })
  @IsOptional()
  @IsString({ message: '分类图标必须是字符串' })
  @MaxLength(200, { message: '分类图标最长 200 个字符' })
  icon?: string;
}

export class UpdateMarketingProductCategoryDto {
  @ApiPropertyOptional({ example: '推拿按摩', description: '分类名称' })
  @IsOptional()
  @IsString({ message: '分类名称必须是字符串' })
  @Transform(trimString)
  @MinLength(1, { message: '分类名称不能为空' })
  @MaxLength(20, { message: '分类名称最长 20 个字符' })
  name?: string;

  @ApiPropertyOptional({
    example: '💆',
    description: '分类图标（空字符串表示清空）',
  })
  @IsOptional()
  @IsString({ message: '分类图标必须是字符串' })
  @MaxLength(200, { message: '分类图标最长 200 个字符' })
  icon?: string;
}

export class CreateMarketingProductDto {
  @ApiProperty({ example: '推拿 3人套餐', description: '产品名称' })
  @IsString({ message: '产品名称必须是字符串' })
  @Transform(trimString)
  @MinLength(1, { message: '产品名称不能为空' })
  @MaxLength(30, { message: '产品名称最长 30 个字符' })
  name: string;

  @ApiProperty({ example: 1, description: '分类 ID' })
  @Transform(transformRequiredInt)
  @IsInt({ message: '分类 ID 必须是整数' })
  @Min(1, { message: '分类 ID 必须大于等于 1' })
  categoryId: number;

  @ApiProperty({
    example: 298,
    description: '售价，单位：元（后端自动转为分存储）',
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '售价必须是数字' },
  )
  @IsPositive({ message: '售价必须大于 0' })
  price: number;

  @ApiPropertyOptional({
    example: 399,
    description: '划线价/原价，单位：元（后端自动转为分存储）',
  })
  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '划线价必须是数字' },
  )
  @IsPositive({ message: '划线价必须大于 0' })
  originalPrice?: number;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/products/product.jpg',
    description: '产品封面图（URL 或 base64 DataURL）',
  })
  @IsOptional()
  @IsString({ message: '产品封面图必须是字符串' })
  @MaxLength(MARKETING_PRODUCT_IMAGE_MAX_LENGTH, {
    message: `产品封面图最长 ${MARKETING_PRODUCT_IMAGE_MAX_LENGTH} 个字符`,
  })
  image?: string;

  @ApiPropertyOptional({
    example: '服务内容',
    description: '产品描述标题（如：商品描述、服务内容、注意事项等）',
  })
  @IsOptional()
  @IsString({ message: '产品描述标题必须是字符串' })
  @MaxLength(20, { message: '产品描述标题最长 20 个字符' })
  descriptionTitle?: string;

  @ApiPropertyOptional({
    example: '专业推拿师一对一服务',
    description: '产品描述',
  })
  @IsOptional()
  @IsString({ message: '产品描述必须是字符串' })
  @MaxLength(200, { message: '产品描述最长 200 个字符' })
  description?: string;

  @ApiPropertyOptional({ example: 20, description: '库存数量' })
  @IsOptional()
  @Transform(transformNullableInt)
  @ValidateIf((o: CreateMarketingProductDto) => o.stock != null)
  @IsInt({ message: '库存必须是整数' })
  @Min(0, { message: '库存必须大于等于 0' })
  stock?: number | null;

  @ApiPropertyOptional({ example: 60, description: '服务时长（分钟）' })
  @IsOptional()
  @Transform(transformNullableInt)
  @ValidateIf((o: CreateMarketingProductDto) => o.durationMinutes != null)
  @IsInt({ message: '服务时长必须是整数' })
  @Min(1, { message: '服务时长必须大于 0' })
  durationMinutes?: number | null;

  @ApiPropertyOptional({ example: 3, description: '适用人数' })
  @IsOptional()
  @Transform(transformNullableInt)
  @ValidateIf((o: CreateMarketingProductDto) => o.personCount != null)
  @IsInt({ message: '适用人数必须是整数' })
  @Min(1, { message: '适用人数必须大于 0' })
  personCount?: number | null;

  @ApiPropertyOptional({
    example: '次',
    description: '库存单位（如：次、节、份）',
  })
  @IsOptional()
  @IsString({ message: '单位必须是字符串' })
  @MaxLength(10, { message: '单位最长 10 个字符' })
  unit?: string;
}

export class UpdateMarketingProductDto {
  @ApiPropertyOptional({ example: '推拿 3人套餐', description: '产品名称' })
  @IsOptional()
  @IsString({ message: '产品名称必须是字符串' })
  @Transform(trimString)
  @MinLength(1, { message: '产品名称不能为空' })
  @MaxLength(30, { message: '产品名称最长 30 个字符' })
  name?: string;

  @ApiPropertyOptional({ example: 1, description: '分类 ID' })
  @IsOptional()
  @Transform(transformNullableInt)
  @ValidateIf((o: UpdateMarketingProductDto) => o.categoryId != null)
  @IsInt({ message: '分类 ID 必须是整数' })
  @Min(1, { message: '分类 ID 必须大于等于 1' })
  categoryId?: number | null;

  @ApiPropertyOptional({
    example: 298,
    description: '售价，单位：元（后端自动转为分存储）',
  })
  @IsOptional()
  @Transform(transformNullableYuan)
  @ValidateIf((o: UpdateMarketingProductDto) => o.price != null)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '售价必须是数字' },
  )
  @IsPositive({ message: '售价必须大于 0' })
  price?: number | null;

  @ApiPropertyOptional({
    example: 399,
    description: '划线价/原价，单位：元；空字符串或 null 表示清空',
  })
  @IsOptional()
  @Transform(transformNullableYuan)
  @ValidateIf((o: UpdateMarketingProductDto) => o.originalPrice != null)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '划线价必须是数字' },
  )
  @IsPositive({ message: '划线价必须大于 0' })
  originalPrice?: number | null;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/products/product.jpg',
    description: '产品封面图（空字符串表示清空）',
  })
  @IsOptional()
  @IsString({ message: '产品封面图必须是字符串' })
  @MaxLength(MARKETING_PRODUCT_IMAGE_MAX_LENGTH, {
    message: `产品封面图最长 ${MARKETING_PRODUCT_IMAGE_MAX_LENGTH} 个字符`,
  })
  image?: string;

  @ApiPropertyOptional({
    example: '服务内容',
    description: '产品描述标题（空字符串表示清空）',
  })
  @IsOptional()
  @IsString({ message: '产品描述标题必须是字符串' })
  @MaxLength(20, { message: '产品描述标题最长 20 个字符' })
  descriptionTitle?: string;

  @ApiPropertyOptional({
    example: '专业推拿师一对一服务',
    description: '产品描述（空字符串表示清空）',
  })
  @IsOptional()
  @IsString({ message: '产品描述必须是字符串' })
  @MaxLength(200, { message: '产品描述最长 200 个字符' })
  description?: string;

  @ApiPropertyOptional({ example: 20, description: '库存数量' })
  @IsOptional()
  @Transform(transformNullableInt)
  @ValidateIf((o: UpdateMarketingProductDto) => o.stock != null)
  @IsInt({ message: '库存必须是整数' })
  @Min(0, { message: '库存必须大于等于 0' })
  stock?: number | null;

  @ApiPropertyOptional({
    example: 60,
    description: '服务时长（分钟）；空字符串或 null 表示清空',
    nullable: true,
  })
  @IsOptional()
  @Transform(transformNullableInt)
  @ValidateIf((o: UpdateMarketingProductDto) => o.durationMinutes != null)
  @IsInt({ message: '服务时长必须是整数' })
  @Min(1, { message: '服务时长必须大于 0' })
  durationMinutes?: number | null;

  @ApiPropertyOptional({
    example: 3,
    description: '适用人数；空字符串或 null 表示清空',
    nullable: true,
  })
  @IsOptional()
  @Transform(transformNullableInt)
  @ValidateIf((o: UpdateMarketingProductDto) => o.personCount != null)
  @IsInt({ message: '适用人数必须是整数' })
  @Min(1, { message: '适用人数必须大于 0' })
  personCount?: number | null;

  @ApiPropertyOptional({
    example: '次',
    description: '库存单位；空字符串表示清空',
  })
  @IsOptional()
  @IsString({ message: '单位必须是字符串' })
  @MaxLength(10, { message: '单位最长 10 个字符' })
  unit?: string | null;
}

export class ToggleMarketingProductDto {
  @ApiProperty({ example: true, description: '是否上架' })
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive: boolean;
}

export class MarketingProductCategoryDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '推拿按摩' })
  name: string;

  @ApiPropertyOptional({ example: '💆' })
  icon?: string;

  @ApiProperty({ example: 1715000000000 })
  createdAt: number;

  @ApiPropertyOptional({ example: 1715086399999 })
  updatedAt?: number;
}

export class MarketingProductCategoriesResponseDto {
  @ApiProperty({ type: [MarketingProductCategoryDto] })
  items: MarketingProductCategoryDto[];
}

export class MarketingProductDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '推拿 3人套餐' })
  name: string;

  @ApiProperty({ example: '1' })
  categoryId: string;

  @ApiProperty({ example: '推拿按摩' })
  categoryName: string;

  @ApiProperty({ example: 29800, description: '售价，单位：分' })
  price: number;

  @ApiPropertyOptional({ example: 39900, description: '划线价/原价，单位：分' })
  originalPrice?: number;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/products/product.jpg',
  })
  image?: string;

  @ApiPropertyOptional({ example: '服务内容', description: '产品描述标题' })
  descriptionTitle?: string;

  @ApiPropertyOptional({ example: '专业推拿师一对一服务' })
  description?: string;

  @ApiProperty({ example: 20, description: '库存数量' })
  stock: number;

  @ApiPropertyOptional({ example: 60 })
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 3 })
  personCount?: number;

  @ApiPropertyOptional({ example: '次', description: '库存单位' })
  unit?: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 1715000000000 })
  createdAt: number;

  @ApiPropertyOptional({ example: 1715086399999 })
  updatedAt?: number;
}

export class MarketingProductsResponseDto {
  @ApiProperty({ type: [MarketingProductDto] })
  items: MarketingProductDto[];

  @ApiProperty({ example: 1, description: '总数' })
  total: number;

  @ApiProperty({ example: 1, description: '当前页码' })
  page: number;

  @ApiProperty({ example: 20, description: '每页数量' })
  pageSize: number;
}
