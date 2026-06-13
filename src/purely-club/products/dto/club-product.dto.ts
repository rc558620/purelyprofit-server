import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  transformOptionalBoolean,
  transformOptionalInt,
} from '../../../purely-profit/stores/dto/store-response.dto';
import type { ClubAppliedPromotion } from '../club-products.types';

const CLUB_SERVICE_PRODUCT_TYPE_VALUES = [
  'product',
  'package',
  'experience',
] as const;

export type ClubServiceProductTypeValue =
  (typeof CLUB_SERVICE_PRODUCT_TYPE_VALUES)[number];

export class ListClubProductsQueryDto {
  @ApiPropertyOptional({
    example: true,
    description: '是否仅返回精选/热门商品；首页可传 true',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: 'featured 必须是布尔值' })
  featured?: boolean;

  @ApiPropertyOptional({
    example: 6,
    description: '返回条数上限；不传则按接口默认行为返回',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 必须大于等于 1' })
  @Max(50, { message: 'limit 必须小于等于 50' })
  limit?: number;
}

export class ClubProductDto {
  @ApiProperty({ example: '1', description: '商品 ID' })
  @IsString({ message: '商品 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '经典养护套餐', description: '商品名称' })
  @IsString({ message: '商品名称必须是字符串' })
  name: string;

  @ApiProperty({
    example: '深层清洁 + 补水保湿，恢复肌肤光泽活力',
    description: '商品描述',
  })
  @IsString({ message: '商品描述必须是字符串' })
  description: string;

  @ApiProperty({ example: '', description: '封面图 URL；无图时返回空字符串' })
  @IsString({ message: '封面图必须是字符串' })
  coverImage: string;

  @ApiProperty({ example: 288, description: '原价，单位元' })
  originalPrice: number;

  @ApiProperty({
    example: 199,
    description: '会员价，单位元；命中首单优惠时返回折后价',
  })
  memberPrice: number;

  @ApiPropertyOptional({
    example: '18',
    description: '命中的首单优惠活动 ID；未命中时不返回',
  })
  @IsOptional()
  @IsString({ message: 'promotionId 必须是字符串' })
  promotionId?: string;

  @ApiPropertyOptional({
    example: 'first_order_discount',
    description: '命中的活动类型；当前仅支持首单优惠',
  })
  @IsOptional()
  @IsString({ message: 'promotionType 必须是字符串' })
  promotionType?: string;

  @ApiPropertyOptional({
    example: 75,
    description: '命中的折扣率；75 表示 7.5 折',
  })
  @IsOptional()
  @IsInt({ message: 'discountRate 必须是整数' })
  discountRate?: number;

  @ApiPropertyOptional({
    example: '首单 7.5 折',
    description: '活动文案标签；命中首单优惠时返回',
  })
  @IsOptional()
  @IsString({ message: 'promotionTag 必须是字符串' })
  promotionTag?: string;

  @ApiProperty({
    example: 199,
    description: '最终价格（叠加所有优惠后），单位元',
  })
  finalPrice: number;

  @ApiPropertyOptional({
    example: 0.9,
    nullable: true,
    description: '会员等级折扣率（0~1），如 0.9 表示 9 折；null 表示无等级折扣',
  })
  @IsOptional()
  memberDiscountRate?: number | null;

  @ApiPropertyOptional({
    example: false,
    description: '等级折扣是否被活动折扣覆盖（前端划线展示）',
  })
  @IsOptional()
  @IsBoolean({ message: 'levelOverridden 必须是布尔值' })
  levelOverridden?: boolean;

  @ApiPropertyOptional({
    example: 50,
    description: '满减减免金额（元）；无满减时不返回',
  })
  @IsOptional()
  reduceAmount?: number;

  @ApiPropertyOptional({
    description: '已应用的优惠活动列表（折扣竞争 + 满减叠加）',
    type: [Object],
  })
  @IsOptional()
  @IsArray({ message: 'appliedPromotions 必须是数组' })
  appliedPromotions?: ClubAppliedPromotion[];

  @ApiProperty({
    example: 'package',
    enum: CLUB_SERVICE_PRODUCT_TYPE_VALUES,
    description: '服务商品类型',
  })
  @IsIn(CLUB_SERVICE_PRODUCT_TYPE_VALUES, { message: '服务商品类型不合法' })
  type: ClubServiceProductTypeValue;

  @ApiProperty({
    example: ['热销', '护理'],
    description: '商品标签',
    type: [String],
  })
  @IsArray({ message: '商品标签必须是数组' })
  @IsString({ each: true, message: '商品标签项必须是字符串' })
  tags: string[];

  @ApiProperty({ example: true, description: '是否热门/精选' })
  @IsBoolean({ message: '热门标记必须是布尔值' })
  isHot: boolean;

  @ApiPropertyOptional({ example: 30, description: '剩余库存；未设置时不返回' })
  @IsOptional()
  @IsInt({ message: '库存必须是整数' })
  stock?: number;

  @ApiPropertyOptional({
    example: '单次服务约 60 分钟 · 适用 1 人',
    description: '有效期或服务说明',
  })
  @IsOptional()
  @IsString({ message: '有效期说明必须是字符串' })
  validityDesc?: string;

  @ApiProperty({
    example: ['深层清洁护理', '服务分类：面部护理', '参考时长：60 分钟'],
    description: '服务详情条目',
    type: [String],
  })
  @IsArray({ message: '服务详情必须是数组' })
  @IsString({ each: true, message: '服务详情项必须是字符串' })
  details: string[];
}

export class ClubProductsResponseDto {
  @ApiProperty({ type: [ClubProductDto], description: '商品列表' })
  items: ClubProductDto[];
}
