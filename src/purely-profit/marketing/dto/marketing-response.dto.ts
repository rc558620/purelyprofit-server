// ─── 营销中心 Response DTOs ─────────────────────────────────────────────
//
// 约定：
//  - 金额字段单位：元（number，由 Money 类在 mapper 层完成 分→元 转换）
//    ⚠️ 极少数历史字段仍以「分」为单位，已在 ApiProperty.description 中显式标注
//  - 时间戳字段单位：毫秒（number）
// 手机号在响应中返回完整号码（商家需联系顾客）

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CLUB_MEMBER_LEVEL_VALUES,
  type ClubMemberLevelValue,
} from '../../../purely-club/member/dto/club-member-account.dto';
import {
  MARKETING_CUSTOMER_STATUS_VALUES,
  MARKETING_CUSTOMER_TIER_VALUES,
  MARKETING_PAY_TYPE_VALUES,
  MARKETING_POINTS_CHANGE_TYPE_VALUES,
  type MarketingCustomerStatus,
  type MarketingCustomerTierValue,
  type MarketingMemberLevelIdValue,
  type MarketingPayTypeValue,
  type MarketingPointsChangeTypeValue,
} from '../marketing.utils';

import { MarketingPaginationMetaDto } from './marketing-pagination-meta.dto';
import { MarketingRechargeDto } from './marketing-response-recharge.dto';

export { MarketingPaginationMetaDto } from './marketing-pagination-meta.dto';

// ─── 顾客 ─────────────────────────────────────────────────────────────

export class MarketingCustomerDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '张三' })
  name: string;

  /** 完整手机号（商家联系顾客用）；无手机号时为空字符串 */
  @ApiProperty({ example: '13800000001' })
  phone: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.jpg' })
  avatar?: string;

  @ApiProperty({
    example: 'gold',
    enum: MARKETING_CUSTOMER_TIER_VALUES,
    description: '会员等级（regular < gold < diamond）',
  })
  tier: MarketingCustomerTierValue;

  /** 储值余额（元） */
  @ApiProperty({ example: 500, description: '储值余额，单位：元' })
  balance: number;

  /** 积分余额 */
  @ApiProperty({ example: 320 })
  points: number;

  /** 累计消费金额（元） */
  @ApiProperty({ example: 1580, description: '累计消费金额，单位：元' })
  totalSpent: number;

  /** 消费次数 */
  @ApiProperty({ example: 12 })
  visitCount: number;

  /** 注册时间（毫秒时间戳，对齐前端 registeredAt） */
  @ApiProperty({ example: 1714000000000 })
  registeredAt: number;

  /** 最后消费时间（毫秒时间戳，null 表示从未消费） */
  @ApiPropertyOptional({ example: 1714700000000 })
  lastVisitAt: number | null;

  @ApiProperty({
    example: 'active',
    enum: MARKETING_CUSTOMER_STATUS_VALUES,
    description:
      '顾客活跃状态（new=从未消费 active=30天内 dormant=31-90天 lost=91天+）',
  })
  status: MarketingCustomerStatus;

  @ApiPropertyOptional({ example: 'VIP 老顾客' })
  remark?: string;
}

export class MarketingCustomerDetailDto extends MarketingCustomerDto {
  @ApiPropertyOptional({
    example: 'platinum',
    enum: CLUB_MEMBER_LEVEL_VALUES,
    description:
      '对齐 purely-club 当前会员等级；未开通 purely-club 会员时不返回',
  })
  clubLevel?: ClubMemberLevelValue;

  @ApiPropertyOptional({
    example: '铂金会员',
    description:
      '对齐 purely-club 当前会员等级名称；未开通 purely-club 会员时不返回',
  })
  clubLevelLabel?: string;

  /** 累计充值本金（元）= 仅 type='recharge' 的 amount 汇总，不含赠送 */
  @ApiProperty({
    example: 2680,
    description:
      '累计充值本金（元），仅统计 type=recharge 的本金充值，不含赠送（gift）',
  })
  totalRecharge: number;

  /**
   * 最大可退金额（元）= min(累计充值本金 − 累计退款, 当前余额 − 赠送余额)，
   * 受当前实际余额约束，由后端计算。
   */
  @ApiProperty({
    example: 400,
    description:
      '最大可退金额（元），= min(累计充值本金 − 累计退款, 当前余额 − 赠送余额)',
  })
  refundableAmount: number;

  /**
   * 赠送金额余额（元），基于时间线遍历计算：
   * 充值/赠送时累加 giftAmount，退款时清零，清零后新充值赠送重新累计。
   */
  @ApiProperty({
    example: 33,
    description: '赠送金额余额（元），基于时间线遍历（充值累加赠送、退款清零）',
  })
  giftBalance: number;

  /**
   * 积分抵扣金额（元）= 该顾客所有消费记录 points_deducted 汇总。
   * ⚠️ 注意：此字段是以「元」为单位的抵扣金额，而非抵扣的积分个数。
   */
  @ApiProperty({
    example: 15,
    description:
      '积分抵扣金额（元），= SUM(marketing_consumptions.points_deducted)；注意是金额而非积分个数',
  })
  totalPointsDeducted: number;

  /** 最近 5 条储值记录，用于顾客详情页概览 */
  @ApiProperty({ type: () => [MarketingRechargeDto] })
  recentRecharges: MarketingRechargeDto[];

  /** 最近 5 条消费记录，用于顾客详情页概览 */
  @ApiProperty({ type: () => [MarketingConsumptionDto] })
  recentConsumptions: MarketingConsumptionDto[];
}

export class MarketingCustomersResponseDto {
  @ApiProperty({ type: [MarketingCustomerDto] })
  items: MarketingCustomerDto[];

  @ApiProperty({ type: MarketingPaginationMetaDto })
  meta: MarketingPaginationMetaDto;
}

// ─── 储值记录（已抽离至 marketing-response-recharge.dto.ts）─────────
// ─── 活动（已抽离至 marketing-response-promotion.dto.ts）─────────────
// ─── 概览数据（已抽离至 marketing-response-overview.dto.ts）───────────

// ─── 消费记录 ─────────────────────────────────────────────────────────

export class MarketingConsumptionDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '1' })
  customerId: string;

  /** 消费金额（元） */
  @ApiProperty({ example: 58, description: '消费金额，单位：元' })
  amount: number;

  /** 余额支付金额（元） */
  @ApiProperty({ example: 20, description: '余额支付金额，单位：元' })
  balancePaid: number;

  /** 积分抵扣金额（元）；注意是金额（元），非抵扣积分个数 */
  @ApiProperty({
    example: 0,
    description: '积分抵扣金额（元），非积分个数',
  })
  pointsDeducted: number;

  /** D4: 实际扣减积分个数（写入时由 ratio 折算固化，与 pointsDeducted 可独立核对） */
  @ApiProperty({
    example: 0,
    description: '实际扣减积分个数，写入时由 redeemRatioPoints 折算固化',
  })
  actualPointsDeducted: number;

  @ApiProperty({
    example: 'cash',
    enum: MARKETING_PAY_TYPE_VALUES,
  })
  payType: MarketingPayTypeValue;

  @ApiPropertyOptional({ example: '拿铁 × 2' })
  itemsSummary?: string;

  @ApiPropertyOptional({ example: '3' })
  promotionId?: string;

  @ApiPropertyOptional({
    example: '夏日满减',
    description: '关联活动名称（来自 marketing_promotions.name）',
  })
  promotionName?: string;

  /** 创建时间（毫秒时间戳） */
  @ApiProperty({ example: 1714700000000 })
  createdAt: number;
}

export class MarketingConsumptionsResponseDto {
  @ApiProperty({ type: [MarketingConsumptionDto] })
  items: MarketingConsumptionDto[];

  @ApiProperty({ type: MarketingPaginationMetaDto })
  meta: MarketingPaginationMetaDto;
}

// ─── 积分流水 ─────────────────────────────────────────────────────────

export class MarketingPointsRecordDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '1' })
  customerId: string;

  @ApiProperty({
    example: -200,
    description: '积分变动值；正数=获得，负数=消耗',
  })
  amount: number;

  @ApiProperty({
    example: 'spend',
    enum: MARKETING_POINTS_CHANGE_TYPE_VALUES,
    description: '积分流水类型',
  })
  type: MarketingPointsChangeTypeValue;

  @ApiProperty({ example: '消费抵扣：拿铁 × 2' })
  description: string;

  @ApiProperty({ example: 1714700000000 })
  createdAt: number;
}

export class MarketingPointsRecordsResponseDto {
  @ApiProperty({ type: [MarketingPointsRecordDto] })
  items: MarketingPointsRecordDto[];

  @ApiProperty({ type: MarketingPaginationMetaDto })
  meta: MarketingPaginationMetaDto;
}

// ─── 会员等级设置 ─────────────────────────────────────────────────────

export class MarketingMemberLevelDto {
  @ApiProperty({ example: 'gold' })
  id: MarketingMemberLevelIdValue;

  @ApiProperty({ example: '黄金会员' })
  name: string;

  @ApiProperty({
    example: 90,
    description: '等级折扣率百分比，1~99，如 90 表示 9 折',
  })
  discountRatePct: number;

  @ApiProperty({
    example: 5000,
    description: '升级所需累计消费金额，单位：元',
  })
  spendThreshold: number;

  @ApiProperty({ example: '累计消费 ≥ ¥5,000' })
  description: string;

  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({ example: 1715000000000 })
  updatedAt: number;
}

export class MarketingPointsRatioDto {
  @ApiProperty({
    example: 200,
    description:
      '每消费多少元得 1 积分，单位：元；如 200 表示消费 200 元得 1 积分',
  })
  earnRatioYuan: number;

  @ApiProperty({ example: 100, description: '多少积分抵扣 1 元' })
  redeemRatioPoints: number;

  @ApiProperty({
    example: 50,
    description: '单次消费最大积分抵扣百分比，1~100，如 50 表示最多抵扣 50%',
  })
  maxRedeemPct: number;

  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({ example: 1715000000000 })
  updatedAt: number;
}

export class MarketingMemberLevelSettingsDto {
  @ApiProperty({ type: [MarketingMemberLevelDto] })
  levels: MarketingMemberLevelDto[];

  @ApiProperty({ type: MarketingPointsRatioDto })
  pointsRatio: MarketingPointsRatioDto;

  @ApiProperty({
    example: true,
    description:
      '积分功能开关；仅当当前存在启用中的充值赠积分活动且赠送比例大于 0 时返回 true',
  })
  pointsFeatureEnabled: boolean;
}

// ─── 活动 & 概览已抽离 ───────────────────────────────────────────────
// Re-export: 保持外部 import 路径不变
export {
  MarketingRechargeDto,
  MarketingRechargesResponseDto,
} from './marketing-response-recharge.dto';
export {
  MarketingPromotionDto,
  MarketingPromotionsResponseDto,
} from './marketing-response-promotion.dto';
export {
  MarketingOverviewDto,
  MarketingOverviewMonthlyTrendPointDto,
  MarketingOverviewTrendPointDto,
  MarketingWechatPayConfigDto,
} from './marketing-response-overview.dto';
