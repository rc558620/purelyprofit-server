import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  MARKETING_MEMBER_LEVEL_ID_VALUES,
  MARKETING_PROMOTION_TYPE_VALUES,
  type MarketingMemberLevelIdValue,
  type MarketingPromotionStatus,
  type MarketingPromotionTypeValue,
} from '../marketing.utils';
import { MarketingPageQueryDto } from './marketing-pagination-query.dto';

const PROMOTION_STATUS_VALUES = [
  'all',
  'upcoming',
  'active',
  'ended',
] as const satisfies readonly ['all', ...MarketingPromotionStatus[]];

export class ListPromotionsQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 'active',
    enum: PROMOTION_STATUS_VALUES,
    description:
      '活动状态（all=全部 upcoming=未开始 active=进行中 ended=已结束）',
  })
  @IsOptional()
  @IsIn(PROMOTION_STATUS_VALUES, { message: '无效的活动状态' })
  status?: MarketingPromotionStatus | 'all';

  @ApiPropertyOptional({
    example: true,
    description: '是否上架（true=仅上架 false=仅下架 不传=全部）',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true || value === 1 || value === '1')
      return true;
    if (value === 'false' || value === false || value === 0 || value === '0')
      return false;
    return value;
  })
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}

export class CreatePromotionDto {
  @ApiPropertyOptional({ example: '夏日满减活动', description: '活动名称' })
  @IsString({ message: '活动名称必须是字符串' })
  @MinLength(1, { message: '活动名称不能为空' })
  @MaxLength(100, { message: '活动名称最长 100 个字符' })
  name: string;

  @ApiPropertyOptional({
    example: 'first_order_discount',
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
    example: {
      gradients: [
        { rechargeAmount: 100, giftAmount: 10 },
        { rechargeAmount: 300, giftAmount: 50 },
      ],
    },
    description:
      '优惠参数 JSON（按 type 不同格式各异；金额字段单位=元，后端 mapper 层统一转分存储）；储值赠送支持 gradients 多档配置',
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

  @ApiPropertyOptional({
    example: { discountRate: 80, audience: 'first_order' },
    description:
      '更新活动参数；首单优惠可传折扣率，储值赠送可传 gradients 多档配置',
  })
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

export class UpdateMarketingMemberLevelDto {
  @ApiPropertyOptional({
    example: 90,
    description: '等级折扣率百分比，1~99，如 90 表示 9 折',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'discountRatePct 必须是数字' })
  @Min(1, { message: 'discountRatePct 必须大于等于 1' })
  @Max(99, { message: 'discountRatePct 必须小于等于 99' })
  discountRatePct?: number;

  @ApiPropertyOptional({
    example: 5000,
    description: '升级所需累计消费金额，单位：元',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'spendThreshold 必须是整数' })
  @Min(0, { message: 'spendThreshold 不能小于 0' })
  spendThreshold?: number;

  @ApiPropertyOptional({
    example: '累计消费 ≥ ¥5,000',
    description: '等级说明',
  })
  @IsOptional()
  @IsString({ message: 'description 必须是字符串' })
  @MaxLength(30, { message: 'description 最长 30 个字符' })
  description?: string;

  @ApiPropertyOptional({ example: true, description: '是否启用该等级' })
  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}

export class UpdateMarketingPointsRatioDto {
  @ApiPropertyOptional({
    example: 200,
    description: '每消费多少元得 1 积分，如 200 表示消费 200 元得 1 积分',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'earnRatioYuan 必须是整数' })
  @Min(1, { message: 'earnRatioYuan 必须大于 0' })
  earnRatioYuan?: number;

  @ApiPropertyOptional({
    example: 100,
    description: '多少积分抵扣 1 元',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'redeemRatioPoints 必须是整数' })
  @Min(1, { message: 'redeemRatioPoints 必须大于 0' })
  redeemRatioPoints?: number;

  @ApiPropertyOptional({
    example: 50,
    description: '单次消费最大积分抵扣百分比，1~100，如 50 表示最多抵扣 50%',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'maxRedeemPct 必须是数字' })
  @Min(1, { message: 'maxRedeemPct 必须大于等于 1' })
  @Max(100, { message: 'maxRedeemPct 必须小于等于 100' })
  maxRedeemPct?: number;

  @ApiPropertyOptional({ example: true, description: '是否启用积分规则' })
  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}

export const isMarketingMemberLevelId = (
  value: string,
): value is MarketingMemberLevelIdValue =>
  MARKETING_MEMBER_LEVEL_ID_VALUES.includes(
    value as MarketingMemberLevelIdValue,
  );
