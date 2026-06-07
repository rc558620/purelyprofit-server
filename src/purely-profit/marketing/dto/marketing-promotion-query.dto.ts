import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  MARKETING_PROMOTION_TYPE_VALUES,
  type MarketingPromotionStatus,
  type MarketingPromotionTypeValue,
} from '../marketing.utils';
import { MarketingPageQueryDto } from './marketing-pagination-query.dto';

const PROMOTION_STATUS_VALUES = [
  'upcoming',
  'active',
  'ended',
] as const satisfies readonly MarketingPromotionStatus[];

export class ListPromotionsQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 'active',
    enum: PROMOTION_STATUS_VALUES,
    description: '活动状态（upcoming=未开始 active=进行中 ended=已结束）',
  })
  @IsOptional()
  @IsIn(PROMOTION_STATUS_VALUES, { message: '无效的活动状态' })
  status?: MarketingPromotionStatus;
}

export class CreatePromotionDto {
  @ApiPropertyOptional({ example: '夏日满减活动', description: '活动名称' })
  @IsString({ message: '活动名称必须是字符串' })
  @MinLength(1, { message: '活动名称不能为空' })
  @MaxLength(100, { message: '活动名称最长 100 个字符' })
  name: string;

  @ApiPropertyOptional({
    example: 'reduce',
    enum: MARKETING_PROMOTION_TYPE_VALUES,
    description: '活动类型',
  })
  @IsIn(MARKETING_PROMOTION_TYPE_VALUES, { message: '无效的活动类型' })
  type: MarketingPromotionTypeValue;

  @ApiPropertyOptional({ example: '满 100 减 20 元', description: '活动描述' })
  @IsOptional()
  @IsString({ message: '活动描述必须是字符串' })
  @MaxLength(500, { message: '活动描述最长 500 个字符' })
  description?: string;

  @ApiPropertyOptional({
    example: { threshold: 10000, reduceAmount: 2000 },
    description: '优惠参数 JSON（按 type 不同格式各异）',
  })
  @IsOptional()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '活动开始时间（毫秒时间戳）',
  })
  @IsInt({ message: '开始时间必须是整数时间戳' })
  @Min(0)
  startAt: number;

  @ApiPropertyOptional({
    example: 1715086399999,
    description: '活动结束时间（毫秒时间戳）',
  })
  @IsInt({ message: '结束时间必须是整数时间戳' })
  @Min(0)
  endAt: number;

  @ApiPropertyOptional({ example: true, description: '是否上架（默认 true）' })
  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}

export class UpdatePromotionDto {
  @ApiPropertyOptional({ example: '夏日满减活动', description: '活动名称' })
  @IsOptional()
  @IsString({ message: '活动名称必须是字符串' })
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '满 100 减 20 元', description: '活动描述' })
  @IsOptional()
  @IsString({ message: '活动描述必须是字符串' })
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: { threshold: 10000, discount: 2000 } })
  @IsOptional()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '开始时间（毫秒时间戳）',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  startAt?: number;

  @ApiPropertyOptional({
    example: 1715086399999,
    description: '结束时间（毫秒时间戳）',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  endAt?: number;

  @ApiPropertyOptional({ example: false, description: '是否上架' })
  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}
