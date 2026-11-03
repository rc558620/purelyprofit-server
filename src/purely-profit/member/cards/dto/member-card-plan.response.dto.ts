// 卡模板响应 DTO：金额以「元」出参、时间为毫秒时间戳，与 purelyProfit 前端契约严格对齐
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  MEMBER_CARD_KIND_VALUES,
  type MemberCardKindValue,
} from '../member-card-plan.constants';

/**
 * 卡模板详情。
 *
 * - `price` / `originalPrice` 为元（库内分），由 mapper 用 Money 换算；
 * - `soldCount` / `marketingProductId` 不落库，由售卡订单与营销商品反查派生，
 *   查不到时不下发（前端按「未知」展示，而不是伪造 0）。
 */
export class MemberCardPlanDto {
  @ApiProperty({ example: '1', description: '卡模板 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '年度畅练卡', description: '卡名称' })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'yearly',
    enum: MEMBER_CARD_KIND_VALUES,
    description: '卡类型',
  })
  @IsIn(MEMBER_CARD_KIND_VALUES)
  kind: MemberCardKindValue;

  @ApiProperty({ example: 1999, description: '售价（元）' })
  @IsNumber()
  price: number;

  @ApiPropertyOptional({ example: 2599, description: '划线价（元）' })
  @IsOptional()
  @IsNumber()
  originalPrice?: number;

  @ApiProperty({ example: 365, description: '有效天数' })
  @IsInt()
  @Min(1)
  validDays: number;

  @ApiPropertyOptional({ example: 20, description: '总次数（仅次数卡有值）' })
  @IsOptional()
  @IsInt()
  totalTimes?: number;

  @ApiProperty({ example: 1, description: '一次开台扣减次数' })
  @IsInt()
  @Min(1)
  perUseTimes: number;

  @ApiProperty({
    example: [],
    type: [String],
    description: '可用空间类型编码，空数组表示不限',
  })
  @IsArray()
  @IsString({ each: true })
  usableSpaceTypes: string[];

  @ApiProperty({
    example: [],
    type: [Number],
    description: '可用星期（1-7），空数组表示不限',
  })
  @IsArray()
  @IsInt({ each: true })
  usableWeekdays: number[];

  @ApiPropertyOptional({ example: 4, description: '单次开台最多人数' })
  @IsOptional()
  @IsInt()
  maxGuestPerUse?: number;

  @ApiPropertyOptional({ example: 2, description: '每人限购张数' })
  @IsOptional()
  @IsInt()
  purchaseLimit?: number;

  @ApiPropertyOptional({ example: '12', description: '关联的营销商品 ID' })
  @IsOptional()
  @IsString()
  marketingProductId?: string;

  @ApiPropertyOptional({
    example: 8,
    description: '累计售出张数（由已支付售卡订单派生）',
  })
  @IsOptional()
  @IsInt()
  soldCount?: number;

  @ApiProperty({ example: true, description: '是否上架' })
  @IsBoolean()
  isActive: boolean;

  @ApiProperty({
    example: 1715000000000,
    description: '创建时间（毫秒时间戳）',
  })
  @IsInt()
  createdAt: number;

  @ApiProperty({
    example: 1715086399999,
    description: '更新时间（毫秒时间戳）',
  })
  @IsInt()
  updatedAt: number;
}

/** 卡模板分页列表：分页字段由 buildMarketingPaginationMeta 统一产出 */
export class MemberCardPlansResponseDto {
  @ApiProperty({ type: () => MemberCardPlanDto })
  @IsArray()
  items: MemberCardPlanDto[];

  @ApiProperty({ example: 3, description: '总数' })
  @IsInt()
  total: number;

  @ApiProperty({ example: 1, description: '当前页码' })
  @IsInt()
  page: number;

  @ApiProperty({ example: 20, description: '每页数量' })
  @IsInt()
  pageSize: number;

  @ApiProperty({ example: 1, description: '总页数，至少为 1' })
  @IsInt()
  totalPages: number;
}
