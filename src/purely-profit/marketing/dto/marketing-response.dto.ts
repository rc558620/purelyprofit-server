// ─── 营销中心 Response DTOs ─────────────────────────────────────────────
//
// 约定：
//  - 金额字段单位：分（number，整数）
//  - 时间戳字段单位：毫秒（number）
//  - 手机号在响应中脱敏（maskPhone），原始号码不出现在 API 响应

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MARKETING_CUSTOMER_STATUS_VALUES,
  MARKETING_CUSTOMER_TIER_VALUES,
  MARKETING_PAY_TYPE_VALUES,
  MARKETING_POINTS_CHANGE_TYPE_VALUES,
  MARKETING_PROMOTION_STATUS_VALUES,
  MARKETING_PROMOTION_TYPE_VALUES,
  MARKETING_RECHARGE_TYPE_VALUES,
  type MarketingCustomerStatus,
  type MarketingCustomerTierValue,
  type MarketingPayTypeValue,
  type MarketingPointsChangeTypeValue,
  type MarketingPromotionStatus,
  type MarketingPromotionTypeValue,
  type MarketingRechargeTypeValue,
} from '../marketing.utils';
import type { MarketingPaginationMeta } from '../marketing.utils';

// ─── 分页元信息 ──────────────────────────────────────────────────────

export class MarketingPaginationMetaDto implements MarketingPaginationMeta {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 68 })
  total: number;

  @ApiProperty({ example: 4 })
  totalPages: number;
}

// ─── 顾客 ─────────────────────────────────────────────────────────────

export class MarketingCustomerDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '张三' })
  name: string;

  /** 脱敏后手机号，如「138****0001」；无手机号时为空字符串 */
  @ApiProperty({ example: '138****0001' })
  phone: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.jpg' })
  avatar?: string;

  @ApiProperty({
    example: 'silver',
    enum: MARKETING_CUSTOMER_TIER_VALUES,
    description: '会员等级（regular < silver < gold < diamond）',
  })
  tier: MarketingCustomerTierValue;

  /** 储值余额（分） */
  @ApiProperty({ example: 50000, description: '储值余额，单位：分' })
  balance: number;

  /** 积分余额 */
  @ApiProperty({ example: 320 })
  points: number;

  /** 累计消费金额（分） */
  @ApiProperty({ example: 158000, description: '累计消费金额，单位：分' })
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
    description: '顾客活跃状态（根据最后消费时间计算）',
  })
  status: MarketingCustomerStatus;

  @ApiPropertyOptional({ example: 'VIP 老顾客' })
  remark?: string;
}

export class MarketingCustomerDetailDto extends MarketingCustomerDto {
  /** 累计充值金额（分）= amount + giftAmount 汇总 */
  @ApiProperty({ example: 268000, description: '累计充值金额，单位：分' })
  totalRecharge: number;

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

// ─── 储值记录 ─────────────────────────────────────────────────────────

export class MarketingRechargeDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '1' })
  customerId: string;

  @ApiPropertyOptional({ example: '张三', description: '顾客名称（充值记录列表展示用）' })
  customerName?: string;

  /** 充值金额（分） */
  @ApiProperty({ example: 10000, description: '充值金额，单位：分' })
  amount: number;

  /** 赠送金额（分） */
  @ApiProperty({ example: 1000, description: '赠送金额，单位：分' })
  giftAmount: number;

  @ApiProperty({
    example: 'recharge',
    enum: MARKETING_RECHARGE_TYPE_VALUES,
  })
  type: MarketingRechargeTypeValue;

  @ApiPropertyOptional({ example: '3' })
  promotionId?: string;

  @ApiPropertyOptional({ example: '半年卡储值' })
  note?: string;

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

// ─── 消费记录 ─────────────────────────────────────────────────────────

export class MarketingConsumptionDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '1' })
  customerId: string;

  /** 消费金额（分） */
  @ApiProperty({ example: 5800, description: '消费金额，单位：分' })
  amount: number;

  /** 余额支付金额（分） */
  @ApiProperty({ example: 2000, description: '余额支付金额，单位：分' })
  balancePaid: number;

  /** 积分抵扣金额（分） */
  @ApiProperty({ example: 0, description: '积分抵扣金额，单位：分' })
  pointsDeducted: number;

  @ApiProperty({
    example: 'cash',
    enum: MARKETING_PAY_TYPE_VALUES,
  })
  payType: MarketingPayTypeValue;

  @ApiPropertyOptional({ example: '拿铁 × 2' })
  itemsSummary?: string;

  @ApiPropertyOptional({ example: '3' })
  promotionId?: string;

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

  @ApiProperty({ example: -200, description: '积分变动值；正数=获得，负数=消耗' })
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
    example: { threshold: 10000, reduceAmount: 2000 },
    description: '优惠参数（按 type 不同，严格对齐前端命名）',
  })
  params: Record<string, number>;

  /** 开始时间（毫秒时间戳） */
  @ApiProperty({ example: 1715000000000 })
  startAt: number;

  /** 结束时间（毫秒时间戳） */
  @ApiProperty({ example: 1715086399999 })
  endAt: number;

  /** 参与人次 */
  @ApiProperty({ example: 42 })
  usageCount: number;

  /** 核销总优惠金额（分） */
  @ApiProperty({ example: 84000, description: '核销优惠总额，单位：分' })
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

// ─── 概览数据 ─────────────────────────────────────────────────────────

export class MarketingOverviewTrendPointDto {
  @ApiProperty({ example: '5/1' })
  date: string;

  @ApiProperty({ example: 12800, description: '当天储值金额，单位：分' })
  amount: number;
}

export class MarketingOverviewMonthlyTrendPointDto {
  @ApiProperty({ example: '5月' })
  label: string;

  @ApiPropertyOptional({
    example: 128000,
    nullable: true,
    description: '当月储值金额，单位：分；无数据时为 null',
  })
  amount: number | null;
}

export class MarketingOverviewDto {
  /** 储值总额（分）= 全部未消费余额之和 */
  @ApiProperty({ example: 5000000, description: '储值余额总计，单位：分' })
  totalBalance: number;

  /** 累计储值金额（分）= 全部充值记录到账金额汇总 */
  @ApiProperty({ example: 1680000, description: '累计储值金额，单位：分' })
  totalRecharge: number;

  /** 今日储值金额（分） */
  @ApiProperty({ example: 32000, description: '今日储值金额，单位：分' })
  todayRecharge: number;

  /** 本月储值金额（分） */
  @ApiProperty({ example: 120000, description: '本月储值金额，单位：分' })
  thisMonthRecharge: number;

  /** 储值记录总数 */
  @ApiProperty({ example: 156 })
  rechargeCount: number;

  /** 有过消费记录的会员人数（visitCount > 0） */
  @ApiProperty({ example: 87 })
  activeMemberCount: number;

  /** 近 30 天储值趋势 */
  @ApiProperty({ type: [MarketingOverviewTrendPointDto] })
  last30Days: MarketingOverviewTrendPointDto[];

  /** 当前年份，用于“今年 / 去年”趋势切换 */
  @ApiProperty({ example: 2026 })
  currentYear: number;

  /** 今年每月储值趋势（仅含 recharge/gift） */
  @ApiProperty({ type: [MarketingOverviewMonthlyTrendPointDto] })
  thisYearMonthlyTrend: MarketingOverviewMonthlyTrendPointDto[];

  /** 去年每月储值趋势（仅含 recharge/gift） */
  @ApiProperty({ type: [MarketingOverviewMonthlyTrendPointDto] })
  lastYearMonthlyTrend: MarketingOverviewMonthlyTrendPointDto[];
}
