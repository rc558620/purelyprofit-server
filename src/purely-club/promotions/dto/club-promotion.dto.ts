import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString } from 'class-validator';
import {
  MARKETING_PROMOTION_TYPE_VALUES,
  type MarketingPromotionParamsValue,
  type MarketingPromotionTypeValue,
} from '../../../purely-profit/marketing/marketing.utils';

export const CLUB_PROMOTION_ACTION_TYPE_VALUES = [
  'view_products',
  'open_recharge',
] as const;

export type ClubPromotionActionTypeValue =
  (typeof CLUB_PROMOTION_ACTION_TYPE_VALUES)[number];

export class ClubPromotionDto {
  @ApiProperty({ example: '17', description: '活动 ID' })
  @IsString({ message: '活动 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '新客首单礼遇', description: '活动名称' })
  @IsString({ message: '活动名称必须是字符串' })
  name: string;

  @ApiProperty({
    example: 'first_order_discount',
    enum: MARKETING_PROMOTION_TYPE_VALUES,
    description: '活动类型',
  })
  type: MarketingPromotionTypeValue;

  @ApiProperty({ example: '新顾客首单专享', description: '活动说明' })
  @IsString({ message: '活动说明必须是字符串' })
  description: string;

  @ApiProperty({ example: '首单 8 折', description: '活动利益点文案' })
  @IsString({ message: '活动利益点文案必须是字符串' })
  benefitText: string;

  @ApiProperty({
    example: { discountRate: 80, audience: 'first_order' },
    description: '活动参数，按活动类型返回原始结构',
  })
  @IsObject({ message: '活动参数必须是对象' })
  params: MarketingPromotionParamsValue;

  @ApiProperty({ example: 1715000000000, description: '开始时间（毫秒时间戳）' })
  startAt: number;

  @ApiProperty({ example: 1715086399999, description: '结束时间（毫秒时间戳）' })
  endAt: number;

  @ApiProperty({ example: '进行中', description: '活动状态文案' })
  @IsString({ message: '活动状态文案必须是字符串' })
  statusText: string;

  @ApiProperty({ example: '06.01-06.30', description: '活动时间范围文案' })
  @IsString({ message: '活动时间范围文案必须是字符串' })
  timeRangeText: string;

  @ApiProperty({ example: 90, description: '活动优先级；值越大越靠前' })
  @IsInt({ message: '活动优先级必须是整数' })
  priority: number;

  @ApiProperty({ example: 20, description: '活动排序值；值越小越靠前' })
  @IsInt({ message: '活动排序值必须是整数' })
  sort: number;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/club/promotion-banner.png',
    description: '活动横幅图；未配置时不返回',
  })
  @IsOptional()
  @IsString({ message: '活动横幅图必须是字符串' })
  bannerImage?: string;

  @ApiProperty({ example: '去下单', description: '活动操作按钮文案' })
  @IsString({ message: '活动操作按钮文案必须是字符串' })
  actionText: string;

  @ApiProperty({
    example: 'view_products',
    enum: CLUB_PROMOTION_ACTION_TYPE_VALUES,
    description: '活动跳转类型',
  })
  @IsIn(CLUB_PROMOTION_ACTION_TYPE_VALUES, { message: '活动跳转类型不合法' })
  actionType: ClubPromotionActionTypeValue;

  @ApiProperty({ example: 'club_products', description: '活动跳转目标' })
  @IsString({ message: '活动跳转目标必须是字符串' })
  actionTarget: string;
}

export class ClubPromotionsResponseDto {
  @ApiProperty({ type: [ClubPromotionDto], description: '当前门店进行中的活动列表' })
  items: ClubPromotionDto[];
}
