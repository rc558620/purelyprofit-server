import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Min } from 'class-validator';
import {
  MARKETING_PRODUCT_SORT_VALUES,
  type MarketingProductSortValue,
} from '../marketing.utils';
import { transformNullableInt } from './marketing-product-transforms';
import { MarketingPageQueryDto } from './marketing-pagination-query.dto';

/**
 * 营销产品列表查询参数
 */
export class ListMarketingProductsQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({ example: 1, description: '分类 ID（不传则查全部）' })
  @IsOptional()
  @Transform(transformNullableInt)
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
