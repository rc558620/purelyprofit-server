import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  PaginationQueryDto,
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../../stores/dto/store-response.dto';
import { PRODUCT_SORT_VALUES } from '../../../commerce/commerce.utils';
import { transformOptionalBoolean } from './product-transforms';

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

  @ApiPropertyOptional({
    example: '饮品',
    description: '分类名称（精确匹配文本）',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '分类名称必须是字符串' })
  category?: string;

  @ApiPropertyOptional({
    example: 5,
    description: '分类 ID（优先于 category 文本匹配）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '分类 ID 必须是整数' })
  @Min(1, { message: '分类 ID 必须大于等于 1' })
  categoryId?: number;

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
