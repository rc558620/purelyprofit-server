// ─── 营销中心 Response DTOs · 活动 ───────────────────────────────────
//
// 约定：
//  - 金额字段单位：元（number，由 Money 类在 mapper 层完成 分→元 转换）
//  - 时间戳字段单位：毫秒（number）

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MARKETING_PROMOTION_STATUS_VALUES,
  MARKETING_PROMOTION_TYPE_VALUES,
  type MarketingPromotionParamsValue,
  type MarketingPromotionStatus,
  type MarketingPromotionTypeValue,
} from '../marketing.utils';

import { MarketingPaginationMetaDto } from './marketing-pagination-meta.dto';

// ─── 活动 ─────────────────────────────────────────────────────────────

export class MarketingPromotionDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '夏日满减活动' })
  name: string;

  @ApiProperty({
    example: 'reduce',
    enum: MARKETING_PROMOTION_TYPE_VALUES,
  })
  type: MarketingPromotionTypeValue;

  @ApiProperty({ example: '满 100 减 20 元' })
  description: string;

  @ApiProperty({
    example: {
      gradients: [
        { rechargeAmount: 10000, giftAmount: 1000 },
        { rechargeAmount: 30000, giftAmount: 5000 },
      ],
    },
    description:
      '优惠参数（按 type 不同，严格对齐前端命名；储值赠送支持 gradients 多档配置）',
  })
  params: MarketingPromotionParamsValue;

  /** 后端预计算的展示文案，前端应优先消费此字段而非从 params 推导 */
  @ApiPropertyOptional({
    example: '满 ¥50 减 ¥8',
    description:
      '活动参数展示文案（由后端统一计算，如 "打 8 折"、"满 ¥50 减 ¥8"、"充 ¥100 赠 ¥10 起"、"免单"、"首单 7.5 折"、"充 ¥100 赠 10 积分"）',
  })
  displayText?: string;

  /** 开始时间（毫秒时间戳） */
  @ApiProperty({ example: 1715000000000 })
  startAt: number;

  /** 结束时间（毫秒时间戳） */
  @ApiProperty({ example: 1715086399999 })
  endAt: number;

  /** 参与人次 */
  @ApiProperty({ example: 42 })
  usageCount: number;

  /** 核销总优惠金额（元） */
  @ApiProperty({ example: 840, description: '核销优惠总额，单位：元' })
  totalDiscount: number;

  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({
    example: 'active',
    enum: MARKETING_PROMOTION_STATUS_VALUES,
    description: '活动状态（根据开始/结束时间计算）',
  })
  status: MarketingPromotionStatus;

  /** 创建时间（毫秒时间戳） */
  @ApiProperty({ example: 1714000000000 })
  createdAt: number;
}

export class MarketingPromotionsResponseDto {
  @ApiProperty({ type: [MarketingPromotionDto] })
  items: MarketingPromotionDto[];

  @ApiProperty({ type: MarketingPaginationMetaDto })
  meta: MarketingPaginationMetaDto;
}
