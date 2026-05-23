import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  PLATFORM_MEMBERSHIP_PLAN_IDS,
  PLATFORM_PARTNER_INTENTIONS,
  PLATFORM_PARTNER_PAYMENT_METHODS,
} from './platform-membership-query.dto';

export const PLATFORM_MEMBERSHIP_ORDER_STATUS = [
  'pending',
  'paid',
  'failed',
  'refunded',
] as const;

export const PLATFORM_PARTNER_STATUS = [
  'pending',
  'reviewing',
  'approved',
  'rejected',
] as const;

export const PLATFORM_POINTS_RECORD_TYPES = [
  'earn',
  'spend',
  'expire',
] as const;
export const PLATFORM_POINTS_RECORD_SOURCES = [
  'purchase_bonus',
  'deduct_payment',
  'admin_adjust',
  'expire',
] as const;

export const PLATFORM_BEAN_RECORD_TYPES = [
  'earn',
  'spend',
  'withdraw',
] as const;
export const PLATFORM_BEAN_RECORD_SOURCES = [
  'promo_reward',
  'deduct_payment',
  'withdrawal',
  'admin_adjust',
] as const;

export const PLATFORM_PARTNER_LEVEL_VALUES = [
  'star',
  'elite',
  'legend',
] as const;

export class PlatformMembershipPlanResponseDto {
  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '套餐标识，和前端 MemberPlan.id 保持一致',
  })
  @IsString({ message: '套餐标识必须是字符串' })
  id: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiProperty({ example: '季度会员', description: '套餐名称' })
  @IsString({ message: '套餐名称必须是字符串' })
  name: string;

  @ApiProperty({ example: 9900, description: '套餐价格，单位分' })
  @IsInt({ message: '套餐价格必须是整数' })
  price: number;

  @ApiPropertyOptional({
    example: 11400,
    description: '原价，单位分；永久会员可为空',
  })
  @IsOptional()
  @IsInt({ message: '套餐原价必须是整数' })
  originalPrice?: number | null;

  @ApiPropertyOptional({
    example: 3,
    description: '时长（月）；永久会员为空',
  })
  @IsOptional()
  @IsInt({ message: '套餐时长必须是整数' })
  durationMonths?: number | null;

  @ApiPropertyOptional({
    example: 730,
    description: '有效期天数；永久会员返回该字段',
  })
  @IsOptional()
  @IsInt({ message: '有效期天数必须是整数' })
  validDays?: number | null;

  @ApiPropertyOptional({ example: '省15元', description: '套餐角标文案' })
  @IsOptional()
  @IsString({ message: '套餐角标必须是字符串' })
  badge?: string;

  @ApiPropertyOptional({ example: true, description: '是否为主推套餐' })
  @IsOptional()
  recommended?: boolean;

  @ApiPropertyOptional({
    example: 3300,
    description: '月均价格，单位分；永久会员可为空',
  })
  @IsOptional()
  @IsInt({ message: '月均价格必须是整数' })
  monthlyPrice?: number;
}

export class PlatformMembershipPlanRuleRowDto {
  @ApiProperty({ example: 'product_limit', description: '规则标识' })
  @IsString({ message: '规则标识必须是字符串' })
  key: string;

  @ApiProperty({ example: '商品录入', description: '规则名称' })
  @IsString({ message: '规则名称必须是字符串' })
  name: string;

  @ApiProperty({ example: '最多 3 个', description: '免费版规则文案' })
  @IsString({ message: '免费版规则文案必须是字符串' })
  free: string;

  @ApiProperty({ example: '最多 30 个', description: '月度会员规则文案' })
  @IsString({ message: '月度会员规则文案必须是字符串' })
  monthly: string;

  @ApiProperty({ example: '最多 100 个', description: '季度会员规则文案' })
  @IsString({ message: '季度会员规则文案必须是字符串' })
  quarterly: string;

  @ApiProperty({ example: '无上限', description: '年度会员规则文案' })
  @IsString({ message: '年度会员规则文案必须是字符串' })
  yearly: string;
}

export class PlatformMembershipPlanRulesResponseDto {
  @ApiProperty({
    type: [PlatformMembershipPlanRuleRowDto],
    description: '套餐对比规则表，按前端 memberPlans 页面顺序返回',
  })
  @IsArray({ message: '套餐规则列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipPlanRuleRowDto)
  rows: PlatformMembershipPlanRuleRowDto[];
}

export class PlatformMembershipInfoDto {
  @ApiProperty({ example: true, description: '当前是否为有效会员' })
  @IsBoolean({ message: '会员状态必须是布尔值' })
  isActive: boolean;

  @ApiPropertyOptional({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '当前生效套餐标识，无生效套餐时为空',
  })
  @IsOptional()
  @IsString({ message: '当前套餐标识必须是字符串' })
  planId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number] | null;

  @ApiPropertyOptional({
    example: 'ages会员',
    description: '面向前端展示的套餐名称，无特殊展示需求时为空',
  })
  @IsOptional()
  @IsString({ message: '展示套餐名称必须是字符串' })
  displayPlanName?: string | null;

  @ApiPropertyOptional({
    example: 1776153600000,
    description: '到期时间戳（ms），未开通时为空',
  })
  @IsOptional()
  @IsInt({ message: '到期时间必须是整数' })
  expiredAt: number | null;

  @ApiProperty({ example: 'ABCD23', description: '邀请码（推广码）' })
  @IsString({ message: '邀请码必须是字符串' })
  inviteCode: string;

  @ApiProperty({ example: 1880, description: '累计积分' })
  @IsInt({ message: '累计积分必须是整数' })
  totalPoints: number;

  @ApiProperty({ example: 1280, description: '可用积分' })
  @IsInt({ message: '可用积分必须是整数' })
  availablePoints: number;
}

export class PlatformMembershipApprovedPartnerDto {
  @ApiProperty({ example: '王建国', description: '合伙人姓名' })
  @IsString({ message: '合伙人姓名必须是字符串' })
  name: string;

  @ApiProperty({ example: '13800138000', description: '合伙人联系电话' })
  @IsString({ message: '联系电话必须是字符串' })
  phone: string;

  @ApiPropertyOptional({
    example: 1747123200000,
    description: '成为合伙人的时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '成为合伙人的时间必须是整数' })
  joinedAt?: number;

  @ApiProperty({ example: 114, description: '当前可用纯利豆余额' })
  @IsInt({ message: '纯利豆余额必须是整数' })
  beanBalance: number;

  @ApiProperty({ example: 320, description: '累计获得纯利豆数量' })
  @IsInt({ message: '累计获得纯利豆数量必须是整数' })
  totalEarnedBeans: number;

  @ApiProperty({ example: 120, description: '累计提现纯利豆数量' })
  @IsInt({ message: '累计提现纯利豆数量必须是整数' })
  totalWithdrawnBeans: number;
}

export class PlatformMembershipProfileResponseDto {
  @ApiProperty({
    type: PlatformMembershipInfoDto,
    description: '会员中心头部信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipInfoDto)
  memberInfo: PlatformMembershipInfoDto;

  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '审批通过合伙人的摘要，无则为空',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;
}

export class PlatformMembershipCenterStatsDto {
  @ApiProperty({ example: 8, description: '总推广人数' })
  @IsInt({ message: '总推广人数必须是整数' })
  totalPromos: number;

  @ApiProperty({ example: 3, description: '已充值推广人数' })
  @IsInt({ message: '已充值推广人数必须是整数' })
  chargedPromos: number;
}

export class PlatformMembershipPartnerFollowUpNoteDto {
  @ApiProperty({ example: 'note_1', description: '备注 ID' })
  @IsString({ message: '备注 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '已电话沟通，待补材料', description: '备注内容' })
  @IsString({ message: '备注内容必须是字符串' })
  content: string;

  @ApiProperty({ example: 1747123200000, description: '备注创建时间戳（ms）' })
  @IsInt({ message: '备注创建时间必须是整数' })
  createdAt: number;
}

export class PlatformMembershipPartnerApplicationDto {
  @ApiProperty({ example: '11', description: '申请记录 ID' })
  @IsString({ message: '申请记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '王建国', description: '申请人姓名' })
  @IsString({ message: '申请人姓名必须是字符串' })
  name: string;

  @ApiProperty({ example: '13800138000', description: '申请人手机号' })
  @IsString({ message: '申请人手机号必须是字符串' })
  phone: string;

  @ApiProperty({ example: '44030119900101123X', description: '身份证号' })
  @IsString({ message: '身份证号必须是字符串' })
  idCard: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['广东省', '深圳市', '南山区'],
    description: '所在地区级联值',
  })
  @IsOptional()
  @IsArray({ message: '所在地区必须是数组' })
  @IsString({ each: true, message: '所在地区值必须是字符串' })
  region?: string[];

  @ApiProperty({
    enum: PLATFORM_PARTNER_PAYMENT_METHODS,
    example: 'wechat',
    description: '打款方式',
  })
  @IsString({ message: '打款方式必须是字符串' })
  paymentMethod: (typeof PLATFORM_PARTNER_PAYMENT_METHODS)[number];

  @ApiProperty({ example: 'wx_test_001', description: '打款账号' })
  @IsString({ message: '打款账号必须是字符串' })
  paymentAccount: string;

  @ApiProperty({
    enum: PLATFORM_PARTNER_INTENTIONS,
    example: 'resource',
    description: '合作意向',
  })
  @IsString({ message: '合作意向必须是字符串' })
  intention: (typeof PLATFORM_PARTNER_INTENTIONS)[number];

  @ApiProperty({
    enum: PLATFORM_PARTNER_STATUS,
    example: 'pending',
    description: '申请状态',
  })
  @IsString({ message: '申请状态必须是字符串' })
  status: (typeof PLATFORM_PARTNER_STATUS)[number];

  @ApiProperty({ example: 1747123200000, description: '申请时间戳（ms）' })
  @IsInt({ message: '申请时间必须是整数' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '审核时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '审核时间必须是整数' })
  reviewedAt?: number;

  @ApiPropertyOptional({
    example: 1747219600000,
    description: '成为正式合伙人的时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '成为正式合伙人的时间必须是整数' })
  joinedAt?: number;

  @ApiPropertyOptional({
    example: '有行业资源，希望合作推广',
    description: '申请理由 / 自我介绍',
  })
  @IsOptional()
  @IsString({ message: '申请理由必须是字符串' })
  applyReason?: string;

  @ApiProperty({
    type: [PlatformMembershipPartnerFollowUpNoteDto],
    description: '跟进备注列表',
  })
  @IsArray({ message: '跟进备注列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipPartnerFollowUpNoteDto)
  followUpNotes: PlatformMembershipPartnerFollowUpNoteDto[];

  @ApiProperty({ example: 0, description: '当前纯利豆余额' })
  @IsInt({ message: '纯利豆余额必须是整数' })
  beanBalance: number;

  @ApiProperty({ example: 0, description: '累计获得纯利豆数量' })
  @IsInt({ message: '累计获得纯利豆数量必须是整数' })
  totalEarnedBeans: number;

  @ApiProperty({ example: 0, description: '累计提现纯利豆数量' })
  @IsInt({ message: '累计提现纯利豆数量必须是整数' })
  totalWithdrawnBeans: number;
}

export class PlatformMembershipPartnerLevelDto {
  @ApiPropertyOptional({
    enum: PLATFORM_PARTNER_LEVEL_VALUES,
    example: 'elite',
    description: '当前合伙人等级，非正式合伙人时为空',
  })
  @IsOptional()
  @IsString({ message: '合伙人等级必须是字符串' })
  partnerLevel: (typeof PLATFORM_PARTNER_LEVEL_VALUES)[number] | null;

  @ApiProperty({ example: 12, description: '本月已充值推广人数' })
  @IsInt({ message: '本月已充值推广人数必须是整数' })
  monthChargedCount: number;

  @ApiPropertyOptional({
    example: 18,
    description: '距离下一等级还差人数，最高等级时为空',
  })
  @IsOptional()
  @IsInt({ message: '升级剩余人数必须是整数' })
  monthCountToNextLevel: number | null;
}

export class PlatformMembershipCenterResponseDto {
  @ApiProperty({
    type: PlatformMembershipInfoDto,
    description: '会员中心基础信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipInfoDto)
  memberInfo: PlatformMembershipInfoDto;

  @ApiProperty({ example: 26, description: '剩余会员天数' })
  @IsInt({ message: '剩余会员天数必须是整数' })
  remainingDays: number;

  @ApiProperty({
    type: PlatformMembershipCenterStatsDto,
    description: '会员中心首页权益统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipCenterStatsDto)
  stats: PlatformMembershipCenterStatsDto;

  @ApiProperty({ example: 2, description: '已支付的充值订单数' })
  @IsInt({ message: '充值订单数必须是整数' })
  paidOrderCount: number;

  @ApiPropertyOptional({
    type: PlatformMembershipPartnerApplicationDto,
    description: '当前门店最近一次合伙人申请摘要',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipPartnerApplicationDto)
  myPartnerApplication: PlatformMembershipPartnerApplicationDto | null;

  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '审批通过合伙人的摘要',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;
}

export class PlatformMembershipOrderResponseDto {
  @ApiProperty({ example: '21', description: '订单 ID' })
  @IsString({ message: '订单 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '套餐周期标识',
  })
  @IsString({ message: '套餐周期标识必须是字符串' })
  planId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiProperty({ example: '季度会员', description: '套餐名称' })
  @IsString({ message: '套餐名称必须是字符串' })
  planName: string;

  @ApiProperty({ example: 9900, description: '实付金额，单位分' })
  @IsInt({ message: '实付金额必须是整数' })
  amount: number;

  @ApiProperty({ example: 1500, description: '积分抵扣金额，单位分' })
  @IsInt({ message: '积分抵扣金额必须是整数' })
  pointsDeducted: number;

  @ApiProperty({ example: 1500, description: '实际使用积分数量' })
  @IsInt({ message: '使用积分数量必须是整数' })
  pointsUsed: number;

  @ApiProperty({ example: 2000, description: '纯利豆抵扣金额，单位分' })
  @IsInt({ message: '纯利豆抵扣金额必须是整数' })
  beanDeducted: number;

  @ApiProperty({ example: 20, description: '实际使用纯利豆数量' })
  @IsInt({ message: '使用纯利豆数量必须是整数' })
  beansUsed: number;

  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_ORDER_STATUS,
    description: '订单状态，和前端 OrderStatus 保持一致',
  })
  @IsString({ message: '订单状态必须是字符串' })
  status: (typeof PLATFORM_MEMBERSHIP_ORDER_STATUS)[number];

  @ApiProperty({ example: 1773556800000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 'WX181773556800000',
    description: '微信支付订单号，无则为空',
  })
  @IsOptional()
  @IsString({ message: '微信订单号必须是字符串' })
  wxOrderId?: string;
}

export class PlatformMembershipOrdersOverviewDto {
  @ApiProperty({ example: 3, description: '充值次数' })
  @IsInt({ message: '充值次数必须是整数' })
  orderCount: number;

  @ApiProperty({ example: 46800, description: '累计消费金额，单位分' })
  @IsInt({ message: '累计消费金额必须是整数' })
  totalAmount: number;
}

export class PlatformMembershipOrdersResponseDto {
  @ApiProperty({
    type: PlatformMembershipOrdersOverviewDto,
    description: '充值记录页汇总信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipOrdersOverviewDto)
  overview: PlatformMembershipOrdersOverviewDto;

  @ApiProperty({
    type: [PlatformMembershipOrderResponseDto],
    description: '充值记录列表，按创建时间倒序',
  })
  @IsArray({ message: '充值记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipOrderResponseDto)
  items: PlatformMembershipOrderResponseDto[];
}

export class PlatformMembershipPointsOverviewDto {
  @ApiProperty({ example: 1280, description: '可用积分' })
  @IsInt({ message: '可用积分必须是整数' })
  availablePoints: number;

  @ApiProperty({ example: 1800, description: '累计获得积分' })
  @IsInt({ message: '累计获得积分必须是整数' })
  totalEarned: number;

  @ApiProperty({ example: 520, description: '累计使用/扣减积分' })
  @IsInt({ message: '累计使用积分必须是整数' })
  totalSpent: number;
}

export class PlatformMembershipPointsLogDto {
  @ApiProperty({ example: 'pts-11', description: '积分记录 ID' })
  @IsString({ message: '积分记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    example: 300,
    description: '积分变动值，正数=获得，负数=使用/过期',
  })
  @IsInt({ message: '积分变动值必须是整数' })
  amount: number;

  @ApiProperty({
    enum: PLATFORM_POINTS_RECORD_TYPES,
    example: 'earn',
    description: '积分变动类型',
  })
  @IsString({ message: '积分变动类型必须是字符串' })
  type: (typeof PLATFORM_POINTS_RECORD_TYPES)[number];

  @ApiProperty({
    enum: PLATFORM_POINTS_RECORD_SOURCES,
    example: 'purchase_bonus',
    description: '积分来源',
  })
  @IsString({ message: '积分来源必须是字符串' })
  source: (typeof PLATFORM_POINTS_RECORD_SOURCES)[number];

  @ApiProperty({ example: '购买季度会员赠积分', description: '来源描述' })
  @IsString({ message: '来源描述必须是字符串' })
  description: string;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1749724800000,
    description: '积分到期时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '到期时间必须是整数' })
  expireAt?: number;
}

export class PlatformMembershipPointsLogsResponseDto {
  @ApiProperty({ type: PlatformMembershipInfoDto, description: '当前会员信息' })
  @ValidateNested()
  @Type(() => PlatformMembershipInfoDto)
  memberInfo: PlatformMembershipInfoDto;

  @ApiProperty({
    type: PlatformMembershipPointsOverviewDto,
    description: '积分中心汇总信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPointsOverviewDto)
  overview: PlatformMembershipPointsOverviewDto;

  @ApiProperty({
    type: [PlatformMembershipPointsLogDto],
    description: '积分记录列表，按创建时间倒序',
  })
  @IsArray({ message: '积分记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipPointsLogDto)
  items: PlatformMembershipPointsLogDto[];
}

export class PlatformMembershipBeanOverviewDto {
  @ApiProperty({ example: 114, description: '当前纯利豆余额' })
  @IsInt({ message: '当前纯利豆余额必须是整数' })
  beanBalance: number;

  @ApiProperty({ example: 320, description: '累计获得纯利豆数量' })
  @IsInt({ message: '累计获得纯利豆数量必须是整数' })
  totalEarnedBeans: number;

  @ApiProperty({ example: 120, description: '累计提现纯利豆数量' })
  @IsInt({ message: '累计提现纯利豆数量必须是整数' })
  totalWithdrawnBeans: number;
}

export class PlatformMembershipBeanLogDto {
  @ApiProperty({ example: 'bean-11', description: '纯利豆记录 ID' })
  @IsString({ message: '纯利豆记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    example: -20,
    description: '纯利豆变动值，正数=获得，负数=消耗/提现',
  })
  @IsInt({ message: '纯利豆变动值必须是整数' })
  amount: number;

  @ApiProperty({
    enum: PLATFORM_BEAN_RECORD_TYPES,
    example: 'spend',
    description: '纯利豆变动类型',
  })
  @IsString({ message: '纯利豆变动类型必须是字符串' })
  type: (typeof PLATFORM_BEAN_RECORD_TYPES)[number];

  @ApiProperty({
    enum: PLATFORM_BEAN_RECORD_SOURCES,
    example: 'deduct_payment',
    description: '纯利豆来源',
  })
  @IsString({ message: '纯利豆来源必须是字符串' })
  source: (typeof PLATFORM_BEAN_RECORD_SOURCES)[number];

  @ApiProperty({
    example: '纯利豆抵扣 · 订阅季度会员',
    description: '来源描述',
  })
  @IsString({ message: '来源描述必须是字符串' })
  description: string;

  @ApiPropertyOptional({ example: 'promo-21', description: '关联推广记录 ID' })
  @IsOptional()
  @IsString({ message: '关联推广记录 ID 必须是字符串' })
  relatedPromoId?: string;

  @ApiPropertyOptional({
    example: 'yearly',
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '关联的充值套餐类型',
  })
  @IsOptional()
  @IsString({ message: '关联套餐类型必须是字符串' })
  relatedPlanType?: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiPropertyOptional({
    example: '187****3344',
    description: '关联被推广用户',
  })
  @IsOptional()
  @IsString({ message: '关联被推广用户必须是字符串' })
  relatedUser?: string;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;
}

export class PlatformMembershipBeanLogsResponseDto {
  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '审批通过合伙人的摘要',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;

  @ApiProperty({
    type: PlatformMembershipBeanOverviewDto,
    description: '纯利豆中心汇总信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipBeanOverviewDto)
  overview: PlatformMembershipBeanOverviewDto;

  @ApiProperty({
    type: [PlatformMembershipBeanLogDto],
    description: '纯利豆记录列表，按创建时间倒序',
  })
  @IsArray({ message: '纯利豆记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipBeanLogDto)
  items: PlatformMembershipBeanLogDto[];
}

export class PlatformMembershipPromoStatsDto {
  @ApiProperty({ example: 8, description: '总推广人数' })
  @IsInt({ message: '总推广人数必须是整数' })
  totalPromos: number;

  @ApiProperty({ example: 3, description: '已充值推广人数' })
  @IsInt({ message: '已充值推广人数必须是整数' })
  chargedPromos: number;

  @ApiProperty({ example: 38, description: '推广成功率（百分比整数）' })
  @IsInt({ message: '推广成功率必须是整数' })
  promoRate: number;

  @ApiProperty({ example: 114, description: '通过推广累计获得纯利豆数量' })
  @IsInt({ message: '累计获得纯利豆数量必须是整数' })
  earnedBeans: number;
}

export class PlatformMembershipPromoRecordDto {
  @ApiProperty({ example: 'promo-21', description: '推广记录 ID' })
  @IsString({ message: '推广记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '李四', description: '被推广用户昵称' })
  @IsString({ message: '被推广用户昵称必须是字符串' })
  inviteeName: string;

  @ApiProperty({
    example: '159****4321',
    description: '被推广用户手机号（脱敏）',
  })
  @IsString({ message: '被推广用户手机号必须是字符串' })
  inviteePhone: string;

  @ApiProperty({ example: 1747123200000, description: '注册时间戳（ms）' })
  @IsInt({ message: '注册时间必须是整数' })
  registeredAt: number;

  @ApiProperty({ example: true, description: '是否已充值' })
  @IsBoolean({ message: '是否已充值必须是布尔值' })
  hasCharged: boolean;

  @ApiPropertyOptional({ example: 9900, description: '充值金额，单位分' })
  @IsOptional()
  @IsInt({ message: '充值金额必须是整数' })
  chargedAmount?: number;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '充值时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '充值时间必须是整数' })
  chargedAt?: number;

  @ApiPropertyOptional({
    example: 'quarterly',
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '充值套餐类型',
  })
  @IsOptional()
  @IsString({ message: '充值套餐类型必须是字符串' })
  chargedPlan?: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiPropertyOptional({ example: 22, description: '奖励纯利豆数量' })
  @IsOptional()
  @IsInt({ message: '奖励纯利豆数量必须是整数' })
  rewardBeans?: number;

  @ApiPropertyOptional({ example: false, description: '是否已结算' })
  @IsOptional()
  @IsBoolean({ message: '结算状态必须是布尔值' })
  settled?: boolean;
}

export class PlatformMembershipPromoStatsByPeriodDto {
  @ApiProperty({
    type: PlatformMembershipPromoStatsDto,
    description: '全部时间统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsDto)
  all: PlatformMembershipPromoStatsDto;

  @ApiProperty({
    type: PlatformMembershipPromoStatsDto,
    description: '今日统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsDto)
  today: PlatformMembershipPromoStatsDto;

  @ApiProperty({
    type: PlatformMembershipPromoStatsDto,
    description: '本月统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsDto)
  month: PlatformMembershipPromoStatsDto;

  @ApiProperty({
    type: PlatformMembershipPromoStatsDto,
    description: '本年统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsDto)
  year: PlatformMembershipPromoStatsDto;
}

export class PlatformMembershipPromoCenterResponseDto {
  @ApiProperty({
    type: PlatformMembershipInfoDto,
    description: '会员基础信息，用于推广码展示',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipInfoDto)
  memberInfo: PlatformMembershipInfoDto;

  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '审批通过合伙人的摘要',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;

  @ApiProperty({
    type: PlatformMembershipPartnerLevelDto,
    description: '合伙人等级信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPartnerLevelDto)
  level: PlatformMembershipPartnerLevelDto;

  @ApiProperty({
    type: PlatformMembershipPromoStatsDto,
    description: '推广中心统计信息（全量）',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsDto)
  stats: PlatformMembershipPromoStatsDto;

  @ApiProperty({
    type: PlatformMembershipPromoStatsByPeriodDto,
    description: '按时间维度拆分的推广统计',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPromoStatsByPeriodDto)
  statsByPeriod: PlatformMembershipPromoStatsByPeriodDto;

  @ApiProperty({
    type: [PlatformMembershipPromoRecordDto],
    description: '推广记录列表，按注册时间倒序',
  })
  @IsArray({ message: '推广记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipPromoRecordDto)
  items: PlatformMembershipPromoRecordDto[];
}

export class PlatformMembershipPartnerProfileResponseDto {
  @ApiProperty({ example: true, description: '当前是否为正式合伙人' })
  @IsBoolean({ message: '是否为正式合伙人必须是布尔值' })
  isPartner: boolean;

  @ApiPropertyOptional({
    type: PlatformMembershipPartnerApplicationDto,
    description: '当前门店最近一次申请记录',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipPartnerApplicationDto)
  currentApplication: PlatformMembershipPartnerApplicationDto | null;

  @ApiProperty({
    type: [PlatformMembershipPartnerApplicationDto],
    description: '申请记录列表，按申请时间倒序返回',
  })
  @IsArray({ message: '申请记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipPartnerApplicationDto)
  applications: PlatformMembershipPartnerApplicationDto[];

  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '审批通过合伙人的摘要',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;

  @ApiProperty({
    type: PlatformMembershipPartnerLevelDto,
    description: '合伙人等级信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPartnerLevelDto)
  level: PlatformMembershipPartnerLevelDto;
}

export class PurchasePlatformMembershipOrderResponseDto {
  @ApiProperty({
    type: PlatformMembershipOrderResponseDto,
    description: '最新创建的订单',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipOrderResponseDto)
  order: PlatformMembershipOrderResponseDto;

  @ApiProperty({
    type: PlatformMembershipProfileResponseDto,
    description: '支付后的会员信息与可用纯利豆',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipProfileResponseDto)
  profile: PlatformMembershipProfileResponseDto;

  @ApiProperty({
    type: PlatformMembershipOrdersOverviewDto,
    description: '支付成功后的最新充值汇总',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipOrdersOverviewDto)
  overview: PlatformMembershipOrdersOverviewDto;
}
