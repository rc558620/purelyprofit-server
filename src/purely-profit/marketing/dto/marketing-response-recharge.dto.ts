// ─── 营销中心 Response DTOs · 储值记录 ─────────────────────────────────
//
// 约定：
//  - 金额字段单位：元（number，由 Money 类在 mapper 层完成 分→元 转换）
//  - 时间戳字段单位：毫秒（number）

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MARKETING_RECHARGE_TYPE_VALUES,
  type MarketingRechargeTypeValue,
} from '../marketing.utils';

import { MarketingPaginationMetaDto } from './marketing-pagination-meta.dto';

// ─── 储值记录 ─────────────────────────────────────────────────────────

export class MarketingRechargeDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '1' })
  customerId: string;

  @ApiPropertyOptional({
    example: '张三',
    description: '顾客名称（充值记录列表展示用）',
  })
  customerName?: string;

  /** 充值金额（元） */
  @ApiProperty({ example: 100, description: '充值金额，单位：元' })
  amount: number;

  /** 赠送金额（元） */
  @ApiProperty({ example: 10, description: '赠送金额，单位：元' })
  giftAmount: number;

  /** 到账总额（元）= amount + giftAmount，由后端计算 */
  @ApiProperty({ example: 110, description: '到账总额，单位：元' })
  totalAmount: number;

  /**
   * 带符号充值金额（元）：退款为负值，储值/赠送为正值。
   * 前端可直接用于展示金额方向，无需按 type 手动取负。
   */
  @ApiProperty({
    example: -100,
    description: '带符号充值金额，退款为负，单位：元',
  })
  signedAmount: number;

  /**
   * 带符号到账总额（元）：退款为负值，储值/赠送为正值。
   */
  @ApiProperty({
    example: -110,
    description: '带符号到账总额，退款为负，单位：元',
  })
  signedTotalAmount: number;

  @ApiProperty({
    example: 'recharge',
    enum: MARKETING_RECHARGE_TYPE_VALUES,
  })
  type: MarketingRechargeTypeValue;

  @ApiPropertyOptional({ example: '3' })
  promotionId?: string;

  @ApiPropertyOptional({
    example: '夏日储值赠送',
    description: '关联活动名称（来自 marketing_promotions.name）',
  })
  promotionName?: string;

  @ApiPropertyOptional({ example: '半年卡储值' })
  note?: string;

  /**
   * 赠送清零金额（元）：该笔退款时清零的赠送余额。
   * 仅退款记录且 clearRemainingGift=true 时有值，其他情况不返回。
   */
  @ApiPropertyOptional({
    example: 33,
    description: '赠送清零金额（元），仅退款记录有值',
  })
  giftClearedAmount?: number;

  /** 创建时间（毫秒时间戳） */
  @ApiProperty({ example: 1714700000000 })
  createdAt: number;
}

export class MarketingRechargesResponseDto {
  @ApiProperty({ type: [MarketingRechargeDto] })
  items: MarketingRechargeDto[];

  @ApiProperty({ type: MarketingPaginationMetaDto })
  meta: MarketingPaginationMetaDto;
}
