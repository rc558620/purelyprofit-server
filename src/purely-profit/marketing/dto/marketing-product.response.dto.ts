import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
} from 'class-validator';
import {
  type MarketingProductBillingModeValue,
  type MarketingProductTypeValue,
} from '../marketing.utils';

/**
 * 自动计算费率入参：售价 + 时长 → 元/小时 或 元/次
 */
export class CalculateTimingPriceDto {
  @ApiProperty({ example: 98, description: '产品售价（元）' })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '售价必须是数字' },
  )
  @IsPositive({ message: '售价必须大于 0' })
  price: number;

  @ApiProperty({ example: 45, description: '服务时长/预设时长（分钟）' })
  @IsInt({ message: '时长必须是整数' })
  @Min(1, { message: '时长必须大于 0' })
  durationMinutes: number;

  @ApiPropertyOptional({
    example: 'per_hour',
    enum: ['per_hour', 'per_session'],
    description:
      '计算模式：per_hour=按小时折算（计时单价，默认）；per_session=整次价格（倒计时台位费=售价）',
  })
  @IsOptional()
  @IsIn(['per_hour', 'per_session'], { message: '计算模式不合法' })
  mode?: 'per_hour' | 'per_session';
}

/**
 * 自动计算费率响应：费率（元/小时 或 元/次）
 */
export class CalculateTimingPriceResponseDto {
  @ApiProperty({
    example: 130.67,
    description: '费率（per_hour=元/小时；per_session=元/次）',
  })
  rate: number;
}

/**
 * 营销产品分类 DTO
 */
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

/**
 * 营销产品分类列表响应
 */
export class MarketingProductCategoriesResponseDto {
  @ApiProperty({ type: () => MarketingProductCategoryDto })
  items: MarketingProductCategoryDto[];
}

/**
 * 营销产品详情响应 DTO
 */
export class MarketingProductDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '推拿 3 人套餐' })
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

  @ApiProperty({ example: 'service', description: '商品类型：service/voucher' })
  type: MarketingProductTypeValue;

  @ApiPropertyOptional({ example: 7, description: '团购券有效天数' })
  validDays?: number;

  @ApiPropertyOptional({
    example: 'items',
    description:
      '开台计费方式：items=纯消费 timed=纯计时 mixed=混合 countdown=倒计时',
  })
  billingMode?: MarketingProductBillingModeValue;

  @ApiPropertyOptional({ example: 40, description: '计时单价，单位：元' })
  hourlyRate?: number;

  @ApiPropertyOptional({ example: 60, description: '预设时长，单位：分钟' })
  countdownMinutes?: number;

  @ApiPropertyOptional({ example: 20, description: '台位费，单位：元' })
  countdownPrice?: number;

  @ApiPropertyOptional({ example: true, description: '到时自动结账' })
  autoCheckout?: boolean;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 1715000000000 })
  createdAt: number;

  @ApiPropertyOptional({ example: 1715086399999 })
  updatedAt?: number;
}

/**
 * 营销产品列表响应
 */
export class MarketingProductsResponseDto {
  @ApiProperty({ type: () => MarketingProductDto })
  items: MarketingProductDto[];

  @ApiProperty({ example: 1, description: '总数' })
  total: number;

  @ApiProperty({ example: 1, description: '当前页码' })
  page: number;

  @ApiProperty({ example: 20, description: '每页数量' })
  pageSize: number;
}
