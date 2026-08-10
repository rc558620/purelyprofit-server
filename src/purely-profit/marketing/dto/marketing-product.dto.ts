import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  MARKETING_PRODUCT_BILLING_MODE_VALUES,
  MARKETING_PRODUCT_SORT_VALUES,
  MARKETING_PRODUCT_TYPE_VALUES,
  type MarketingProductBillingModeValue,
  type MarketingProductSortValue,
  type MarketingProductTypeValue,
} from '../marketing.utils';
import { MarketingPageQueryDto } from './marketing-pagination-query.dto';
import {
  MARKETING_PRODUCT_IMAGE_MAX_LENGTH,
  transformNullableInt,
  transformNullableYuan,
  transformRequiredInt,
  trimString,
} from './marketing-product-transforms';

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

  @ApiPropertyOptional({
    example: 'service',
    enum: MARKETING_PRODUCT_TYPE_VALUES,
    description:
      '商品类型：service=服务商品，voucher=团购券商品（支付后生成团购券）',
  })
  @IsOptional()
  @IsIn(MARKETING_PRODUCT_TYPE_VALUES, { message: '商品类型不合法' })
  type?: MarketingProductTypeValue;

  @ApiPropertyOptional({
    example: 7,
    description: '团购券有效天数（type=voucher 时生效，默认 7 天）',
  })
  @IsOptional()
  @Transform(transformNullableInt)
  @ValidateIf((o: CreateMarketingProductDto) => o.validDays != null)
  @IsInt({ message: '团购券有效天数必须是整数' })
  @Min(1, { message: '团购券有效天数必须大于 0' })
  @Max(365, { message: '团购券有效天数最大 365' })
  validDays?: number | null;

  @ApiPropertyOptional({
    example: 'items',
    enum: MARKETING_PRODUCT_BILLING_MODE_VALUES,
    description:
      '开台计费方式（type=voucher 时生效）：items=纯消费 timed=纯计时 mixed=混合 countdown=倒计时',
  })
  @IsOptional()
  @IsIn(MARKETING_PRODUCT_BILLING_MODE_VALUES, { message: '计费方式不合法' })
  billingMode?: MarketingProductBillingModeValue;

  @ApiPropertyOptional({
    example: 40,
    description: '计时单价，单位：元（billingMode=timed/mixed 时生效）',
  })
  @ValidateIf(
    (o: CreateMarketingProductDto) =>
      o.billingMode === 'timed' || o.billingMode === 'mixed',
  )
  @IsDefined({ message: '选择纯计时/混合计费时必须填写计时单价' })
  @Transform(transformNullableYuan)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '计时单价必须是数字' },
  )
  @IsPositive({ message: '计时单价必须大于 0' })
  hourlyRate?: number | null;

  @ApiPropertyOptional({
    example: 60,
    description: '预设时长，单位：分钟（billingMode=countdown 时生效）',
  })
  @ValidateIf((o: CreateMarketingProductDto) => o.billingMode === 'countdown')
  @IsDefined({ message: '选择倒计时计费时必须填写预设时长' })
  @Transform(transformNullableInt)
  @IsInt({ message: '预设时长必须是整数' })
  @Min(1, { message: '预设时长必须大于 0' })
  @Max(1440, { message: '预设时长不能超过 1440 分钟' })
  countdownMinutes?: number | null;

  @ApiPropertyOptional({
    example: 20,
    description: '台位费，单位：元（billingMode=countdown 时生效）',
  })
  @ValidateIf((o: CreateMarketingProductDto) => o.billingMode === 'countdown')
  @IsDefined({ message: '选择倒计时计费时必须填写台位费' })
  @Transform(transformNullableYuan)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '台位费必须是数字' },
  )
  @IsPositive({ message: '台位费必须大于 0' })
  countdownPrice?: number | null;

  @ApiPropertyOptional({
    example: true,
    description: '到时自动结账（billingMode=countdown 时生效）',
  })
  @IsOptional()
  @IsBoolean({ message: '到时自动结账必须是布尔值' })
  autoCheckout?: boolean;
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

  @ApiPropertyOptional({
    example: 'service',
    enum: MARKETING_PRODUCT_TYPE_VALUES,
    description: '商品类型：service=服务商品，voucher=团购券商品',
  })
  @IsOptional()
  @IsIn(MARKETING_PRODUCT_TYPE_VALUES, { message: '商品类型不合法' })
  type?: MarketingProductTypeValue;

  @ApiPropertyOptional({
    example: 7,
    description:
      '团购券有效天数；空字符串或 null 表示清空（type=voucher 时生效）',
    nullable: true,
  })
  @IsOptional()
  @Transform(transformNullableInt)
  @ValidateIf((o: UpdateMarketingProductDto) => o.validDays != null)
  @IsInt({ message: '团购券有效天数必须是整数' })
  @Min(1, { message: '团购券有效天数必须大于 0' })
  @Max(365, { message: '团购券有效天数最大 365' })
  validDays?: number | null;

  @ApiPropertyOptional({
    example: 'items',
    enum: MARKETING_PRODUCT_BILLING_MODE_VALUES,
    description:
      '开台计费方式（type=voucher 时生效）：items=纯消费 timed=纯计时 mixed=混合 countdown=倒计时',
  })
  @IsOptional()
  @IsIn(MARKETING_PRODUCT_BILLING_MODE_VALUES, { message: '计费方式不合法' })
  billingMode?: MarketingProductBillingModeValue;

  @ApiPropertyOptional({
    example: 40,
    description: '计时单价，单位：元（billingMode=timed/mixed 时生效）',
  })
  @ValidateIf(
    (o: UpdateMarketingProductDto) =>
      o.billingMode === 'timed' || o.billingMode === 'mixed',
  )
  @IsDefined({ message: '选择纯计时/混合计费时必须填写计时单价' })
  @Transform(transformNullableYuan)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '计时单价必须是数字' },
  )
  @IsPositive({ message: '计时单价必须大于 0' })
  hourlyRate?: number | null;

  @ApiPropertyOptional({
    example: 60,
    description: '预设时长，单位：分钟（billingMode=countdown 时生效）',
  })
  @ValidateIf((o: UpdateMarketingProductDto) => o.billingMode === 'countdown')
  @IsDefined({ message: '选择倒计时计费时必须填写预设时长' })
  @Transform(transformNullableInt)
  @IsInt({ message: '预设时长必须是整数' })
  @Min(1, { message: '预设时长必须大于 0' })
  @Max(1440, { message: '预设时长不能超过 1440 分钟' })
  countdownMinutes?: number | null;

  @ApiPropertyOptional({
    example: 20,
    description: '台位费，单位：元（billingMode=countdown 时生效）',
  })
  @ValidateIf((o: UpdateMarketingProductDto) => o.billingMode === 'countdown')
  @IsDefined({ message: '选择倒计时计费时必须填写台位费' })
  @Transform(transformNullableYuan)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '台位费必须是数字' },
  )
  @IsPositive({ message: '台位费必须大于 0' })
  countdownPrice?: number | null;

  @ApiPropertyOptional({
    example: true,
    description: '到时自动结账（billingMode=countdown 时生效）',
  })
  @IsOptional()
  @IsBoolean({ message: '到时自动结账必须是布尔值' })
  autoCheckout?: boolean;
}

export class ToggleMarketingProductDto {
  @ApiProperty({ example: true, description: '是否上架' })
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive: boolean;
}

/** 自动计算费率入参：售价 + 时长 → 元/小时 或 元/次 */
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

/** 自动计算费率响应：费率（元/小时 或 元/次） */
export class CalculateTimingPriceResponseDto {
  @ApiProperty({ example: 130.67, description: '费率（per_hour=元/小时；per_session=元/次）' })
  rate: number;
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

  @ApiProperty({ example: 'service', description: '商品类型：service/voucher' })
  type: MarketingProductTypeValue;

  @ApiPropertyOptional({ example: 7, description: '团购券有效天数' })
  validDays?: number;

  @ApiPropertyOptional({
    example: 'items',
    description:
      '开台计费方式：items=纯消费 timed=纯计时 mixed=混合 countdown=倒计时',
  })
  billingMode?: string;

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
