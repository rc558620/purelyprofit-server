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
  MARKETING_PROMOTION_STATUS_VALUES,
  MARKETING_PROMOTION_TYPE_VALUES,
  MARKETING_RECHARGE_TYPE_VALUES,
  type MarketingCustomerStatus,
  type MarketingCustomerTierValue,
  type MarketingMemberLevelIdValue,
  type MarketingPayTypeValue,
  type MarketingPointsChangeTypeValue,
  type MarketingPromotionParamsValue,
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

  /** 累计充值金额（元）= totalAmount 汇总 */
  @ApiProperty({ example: 2680, description: '累计充值金额，单位：元' })
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

  /** 消费金额（元） */
  @ApiProperty({ example: 58, description: '消费金额，单位：元' })
  amount: number;

  /** 余额支付金额（元） */
  @ApiProperty({ example: 20, description: '余额支付金额，单位：元' })
  balancePaid: number;

  /** 积分抵扣金额（元） */
  @ApiProperty({ example: 0, description: '积分抵扣金额，单位：元' })
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

  @ApiProperty({ example: 90, description: '等级折扣率百分比，1~99，如 90 表示 9 折' })
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
    description: '每消费多少元得 1 积分，单位：元；如 200 表示消费 200 元得 1 积分',
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

// ─── 概览数据 ─────────────────────────────────────────────────────────

export class MarketingOverviewTrendPointDto {
  @ApiProperty({ example: '5/1' })
  date: string;

  @ApiProperty({ example: 128, description: '当天储值金额，单位：元' })
  amount: number;
}

export class MarketingOverviewMonthlyTrendPointDto {
  @ApiProperty({ example: '5月' })
  label: string;

  @ApiPropertyOptional({
    example: 1280,
    nullable: true,
    description: '当月储值金额，单位：元；无数据时为 null',
  })
  amount: number | null;
}

export class MarketingWechatPayConfigDto {
  @ApiProperty({
    example: true,
    description: '是否已配置微信收款（mchId + apiV3Key 均存在时为 true）',
  })
  configured: boolean;

  @ApiPropertyOptional({
    example: '1234567890',
    description: '微信商户号；未配置时不返回',
  })
  mchId?: string;

  @ApiPropertyOptional({
    example: '纯利优选昆明店',
    description: '微信商户名称；未配置时不返回',
  })
  mchName?: string;

  @ApiPropertyOptional({
    example: '2026-06-13T12:00:00.000Z',
    description: '最近一次配置时间；未配置时不返回',
  })
  configuredAt?: string;
}

export class MarketingOverviewDto {
  /** 储值总额（元）= 全部未消费余额之和 */
  @ApiProperty({ example: 50000, description: '储值余额总计，单位：元' })
  totalBalance: number;

  /** 累计储值金额（元）= 全部充值记录到账金额汇总 */
  @ApiProperty({ example: 16800, description: '累计储值金额，单位：元' })
  totalRecharge: number;

  /** 今日储值金额（元） */
  @ApiProperty({ example: 320, description: '今日储值金额，单位：元' })
  todayRecharge: number;

  /** 本月储值金额（元） */
  @ApiProperty({ example: 1200, description: '本月储值金额，单位：元' })
  thisMonthRecharge: number;

  /** 储值记录总数 */
  @ApiProperty({ example: 156 })
  rechargeCount: number;

  /** 有过消费记录的会员人数（visitCount > 0） */
  @ApiProperty({ example: 87 })
  activeMemberCount: number;

  /** 门店邀请码，purely-club 可通过该邀请码加入门店；门店尚未创建邀请码时为 null */
  @ApiProperty({ example: 'ABCD23', description: '门店邀请码', nullable: true })
  inviteCode: string | null;

  /** 门店邀请码二维码图片 URL，前端扫码页可直接展示；门店尚未创建邀请码时为 null */
  @ApiProperty({
    example:
      'https://api.qrserver.com/v1/create-qr-code/?size=240x240&format=png&margin=0&data=ABCD23',
    description: '门店邀请码二维码图片地址',
    nullable: true,
  })
  inviteCodeQrCodeImageUrl: string | null;

  /** 近 30 天储值趋势 */
  @ApiProperty({ type: [MarketingOverviewTrendPointDto] })
  last30Days: MarketingOverviewTrendPointDto[];

  /** 当前年份，用于"今年 / 去年"趋势切换 */
  @ApiProperty({ example: 2026 })
  currentYear: number;

  /** 今年每月储值趋势（仅含 recharge/gift） */
  @ApiProperty({ type: [MarketingOverviewMonthlyTrendPointDto] })
  thisYearMonthlyTrend: MarketingOverviewMonthlyTrendPointDto[];

  /** 去年每月储值趋势（仅含 recharge/gift） */
  @ApiProperty({ type: [MarketingOverviewMonthlyTrendPointDto] })
  lastYearMonthlyTrend: MarketingOverviewMonthlyTrendPointDto[];

  /** 微信收款配置状态 */
  @ApiProperty({ type: MarketingWechatPayConfigDto })
  wechatPayConfig: MarketingWechatPayConfigDto;
}
