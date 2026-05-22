import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PLATFORM_MEMBERSHIP_ORDER_STATUS } from '../../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';

// ─────────────────────────────────────────────────────────────
// Request DTOs
// ─────────────────────────────────────────────────────────────

/**
 * POST /pulse/membership/orders/preview
 * 下单试算：传入套餐 + 希望使用的积分/纯利豆，返回价格拆解预览
 */
export class PulseMembershipOrderPreviewDto {
  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '会员套餐周期',
  })
  @IsString({ message: '套餐周期不合法' })
  planId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiPropertyOptional({
    example: 1200,
    description: '希望使用的积分数量（可选，默认 0）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '积分数量必须是整数' })
  @Min(0, { message: '积分数量不能小于 0' })
  usePoints?: number;

  @ApiPropertyOptional({
    example: 10,
    description: '希望使用的纯利豆数量（可选，默认 0），1 豆 = 1 元',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '纯利豆数量必须是整数' })
  @Min(0, { message: '纯利豆数量不能小于 0' })
  useBeans?: number;
}

// ─────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────

/**
 * 下单试算结果：前端用于呈现价格拆解明细
 */
export class PulseMembershipOrderPreviewResponseDto {
  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '套餐周期标识',
  })
  @IsString()
  planId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiProperty({ example: '季度会员', description: '套餐名称' })
  @IsString()
  planName: string;

  @ApiProperty({ example: 9900, description: '套餐原始价格，单位分' })
  @IsInt()
  originalPrice: number;

  @ApiProperty({
    example: 2000,
    description: '纯利豆抵扣金额，单位分（0 = 不抵扣）',
  })
  @IsInt()
  beanDeducted: number;

  @ApiProperty({ example: 20, description: '实际消耗纯利豆数量' })
  @IsInt()
  beansUsed: number;

  @ApiProperty({ example: 7900, description: '纯利豆抵扣后的价格，单位分' })
  @IsInt()
  priceAfterBeans: number;

  @ApiProperty({
    example: 1500,
    description: '积分抵扣金额，单位分（0 = 不抵扣）',
  })
  @IsInt()
  pointsDeducted: number;

  @ApiProperty({ example: 1500, description: '实际消耗积分数量' })
  @IsInt()
  pointsUsed: number;

  @ApiProperty({ example: 6400, description: '最终应付金额，单位分' })
  @IsInt()
  finalAmount: number;

  @ApiProperty({ example: 300, description: '购买该套餐可获得的积分奖励' })
  @IsInt()
  bonusPoints: number;

  @ApiProperty({ example: 1280, description: '用户当前可用积分' })
  @IsInt()
  availablePoints: number;

  @ApiProperty({
    example: 114,
    description: '用户当前可用纯利豆（非合伙人时为 0）',
  })
  @IsInt()
  availableBeans: number;
}

/**
 * GET /pulse/membership/orders/:id
 * 单订单详情
 */
export class PulseMembershipOrderDetailResponseDto {
  @ApiProperty({ example: '21', description: '订单 ID' })
  @IsString()
  id: string;

  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '套餐周期标识',
  })
  @IsString()
  planId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number];

  @ApiProperty({ example: '季度会员', description: '套餐名称' })
  @IsString()
  planName: string;

  @ApiProperty({ example: 9900, description: '套餐原始价格，单位分' })
  @IsInt()
  originalAmount: number;

  @ApiProperty({ example: 9900, description: '实付金额，单位分' })
  @IsInt()
  amount: number;

  @ApiProperty({ example: 1500, description: '积分抵扣金额，单位分' })
  @IsInt()
  pointsDeducted: number;

  @ApiProperty({ example: 1500, description: '实际使用积分数量' })
  @IsInt()
  pointsUsed: number;

  @ApiProperty({ example: 2000, description: '纯利豆抵扣金额，单位分' })
  @IsInt()
  beanDeducted: number;

  @ApiProperty({ example: 20, description: '实际使用纯利豆数量' })
  @IsInt()
  beansUsed: number;

  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_ORDER_STATUS,
    description: '订单状态',
  })
  @IsString()
  status: (typeof PLATFORM_MEMBERSHIP_ORDER_STATUS)[number];

  @ApiPropertyOptional({
    example: 'WX181773556800000',
    description: '微信支付订单号，无则为空',
  })
  @IsOptional()
  @IsString()
  wxOrderId: string | null;

  @ApiProperty({ example: 1773556800000, description: '创建时间戳（ms）' })
  @IsInt()
  createdAt: number;

  @ApiPropertyOptional({
    example: 1773556900000,
    description: '支付时间戳（ms），未支付时为空',
  })
  @IsOptional()
  @IsInt()
  paidAt: number | null;
}

/**
 * GET /pulse/membership/orders/:id/pay-status
 * 支付状态查询（轮询）
 */
export class PulseMembershipOrderPayStatusResponseDto {
  @ApiProperty({ example: '21', description: '订单 ID' })
  @IsString()
  id: string;

  @ApiProperty({
    enum: PLATFORM_MEMBERSHIP_ORDER_STATUS,
    description: '订单当前状态',
  })
  @IsString()
  status: (typeof PLATFORM_MEMBERSHIP_ORDER_STATUS)[number];

  @ApiProperty({ example: false, description: '是否已完成支付' })
  @IsBoolean()
  isPaid: boolean;

  @ApiPropertyOptional({
    example: 1773556900000,
    description: '支付时间戳（ms）',
  })
  @IsOptional()
  @IsInt()
  paidAt: number | null;
}

/**
 * POST /pulse/membership/orders 下单后的会员信息摘要（复用已有类型时的简化版）
 * Pulse 侧直接复用 PurchasePlatformMembershipOrderResponseDto，此处仅作导出别名
 */

export class PulseMembershipPartnerLevelDto {
  @ApiPropertyOptional({
    example: 'elite',
    description: '合伙人等级，非合伙人时为空',
  })
  @IsOptional()
  @IsString()
  partnerLevel: string | null;

  @ApiProperty({ example: 12, description: '本月已充值推广人数' })
  @IsInt()
  monthChargedCount: number;

  @ApiPropertyOptional({
    example: 18,
    description: '距下一等级还差人数，最高等级时为空',
  })
  @IsOptional()
  @IsInt()
  monthCountToNextLevel: number | null;
}

export class PulseMembershipPromoStatsDto {
  @ApiProperty({ example: 8, description: '总推广人数' })
  @IsInt()
  totalPromos: number;

  @ApiProperty({ example: 3, description: '已充值推广人数' })
  @IsInt()
  chargedPromos: number;

  @ApiProperty({ example: 38, description: '推广成功率（百分比整数）' })
  @IsInt()
  promoRate: number;

  @ApiProperty({ example: 114, description: '通过推广累计获得纯利豆数量' })
  @IsInt()
  earnedBeans: number;
}

export class PulseMembershipPromoRecordDto {
  @ApiProperty({ example: 'promo-21', description: '推广记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '李四', description: '被推广用户昵称' })
  @IsString()
  inviteeName: string;

  @ApiProperty({
    example: '159****4321',
    description: '被推广用户手机号（脱敏）',
  })
  @IsString()
  inviteePhone: string;

  @ApiProperty({ example: 1747123200000, description: '注册时间戳（ms）' })
  @IsInt()
  registeredAt: number;

  @ApiProperty({ example: true, description: '是否已充值' })
  @IsBoolean()
  hasCharged: boolean;

  @ApiPropertyOptional({ example: 9900, description: '充值金额，单位分' })
  @IsOptional()
  @IsInt()
  chargedAmount: number | null;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '充值时间戳（ms）',
  })
  @IsOptional()
  @IsInt()
  chargedAt: number | null;

  @ApiPropertyOptional({
    enum: PLATFORM_MEMBERSHIP_PLAN_IDS,
    description: '充值套餐类型',
  })
  @IsOptional()
  @IsString()
  chargedPlan: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number] | null;

  @ApiPropertyOptional({ example: 22, description: '奖励纯利豆数量' })
  @IsOptional()
  @IsInt()
  rewardBeans: number | null;

  @ApiPropertyOptional({ example: false, description: '是否已结算' })
  @IsOptional()
  @IsBoolean()
  settled: boolean;
}

export class PulseMembershipPromoCenterResponseDto {
  @ApiProperty({ example: 'ABCD23', description: '推广码' })
  @IsString()
  inviteCode: string;

  @ApiProperty({
    type: PulseMembershipPartnerLevelDto,
    description: '合伙人等级信息',
  })
  @ValidateNested()
  @Type(() => PulseMembershipPartnerLevelDto)
  level: PulseMembershipPartnerLevelDto;

  @ApiProperty({
    type: PulseMembershipPromoStatsDto,
    description: '推广中心全量统计',
  })
  @ValidateNested()
  @Type(() => PulseMembershipPromoStatsDto)
  stats: PulseMembershipPromoStatsDto;

  @ApiProperty({
    type: [PulseMembershipPromoRecordDto],
    description: '推广记录列表',
  })
  @ValidateNested({ each: true })
  @Type(() => PulseMembershipPromoRecordDto)
  items: PulseMembershipPromoRecordDto[];
}

export const PULSE_ADMIN_MEMBER_POINTS_TYPE_VALUES = [
  'earn',
  'spend',
  'expire',
] as const;
export type PulseAdminMemberPointsTypeValue =
  (typeof PULSE_ADMIN_MEMBER_POINTS_TYPE_VALUES)[number];

export const PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES = [
  'purchase_bonus',
  'deduct_payment',
  'admin_adjust',
  'expire',
] as const;
export type PulseAdminMemberPointsSourceValue =
  (typeof PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES)[number];

export class PulseAdminMemberPointsLogDto {
  @ApiProperty({ example: 'pts-12', description: '积分流水 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '1', description: '会员 ID / 门店 ID' })
  @IsString()
  userId: string;

  @ApiProperty({ example: '刘梅', description: '会员展示名' })
  @IsString()
  userName: string;

  @ApiProperty({ example: '138****9021', description: '会员手机号' })
  @IsString()
  userPhone: string;

  @ApiProperty({ example: 300, description: '积分变动值' })
  @IsInt()
  amount: number;

  @ApiProperty({
    enum: PULSE_ADMIN_MEMBER_POINTS_TYPE_VALUES,
    description: '积分流水方向',
  })
  @IsIn(PULSE_ADMIN_MEMBER_POINTS_TYPE_VALUES)
  type: PulseAdminMemberPointsTypeValue;

  @ApiProperty({
    enum: PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES,
    description: '积分流水来源',
  })
  @IsIn(PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES)
  source: PulseAdminMemberPointsSourceValue;

  @ApiProperty({ example: '管理员调整积分', description: '积分流水说明' })
  @IsString()
  description: string;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt()
  createdAt: number;

  @ApiPropertyOptional({ example: 1749724800000, description: '过期时间戳（ms）' })
  @IsOptional()
  @IsInt()
  expireAt?: number | null;
}

export class PulseAdminMemberPointsLogsResponseDto {
  @ApiProperty({
    type: [PulseAdminMemberPointsLogDto],
    description: '管理员视角会员积分流水列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberPointsLogDto)
  items: PulseAdminMemberPointsLogDto[];
}

export const PULSE_ADMIN_MEMBER_BEAN_TYPE_VALUES = [
  'earn',
  'spend',
  'withdraw',
] as const;
export type PulseAdminMemberBeanTypeValue =
  (typeof PULSE_ADMIN_MEMBER_BEAN_TYPE_VALUES)[number];

export const PULSE_ADMIN_MEMBER_BEAN_SOURCE_VALUES = [
  'promo_reward',
  'deduct_payment',
  'withdrawal',
  'admin_adjust',
] as const;
export type PulseAdminMemberBeanSourceValue =
  (typeof PULSE_ADMIN_MEMBER_BEAN_SOURCE_VALUES)[number];

export class PulseAdminMemberBeanLogDto {
  @ApiProperty({ example: 'bean-12', description: '纯利豆流水 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '1', description: '会员 ID / 门店 ID' })
  @IsString()
  userId: string;

  @ApiProperty({ example: '刘梅', description: '会员展示名' })
  @IsString()
  userName: string;

  @ApiProperty({ example: '138****9021', description: '会员手机号' })
  @IsString()
  userPhone: string;

  @ApiProperty({ example: 22, description: '纯利豆变动值' })
  @IsInt()
  amount: number;

  @ApiProperty({
    enum: PULSE_ADMIN_MEMBER_BEAN_TYPE_VALUES,
    description: '纯利豆流水方向',
  })
  @IsIn(PULSE_ADMIN_MEMBER_BEAN_TYPE_VALUES)
  type: PulseAdminMemberBeanTypeValue;

  @ApiProperty({
    enum: PULSE_ADMIN_MEMBER_BEAN_SOURCE_VALUES,
    description: '纯利豆流水来源',
  })
  @IsIn(PULSE_ADMIN_MEMBER_BEAN_SOURCE_VALUES)
  source: PulseAdminMemberBeanSourceValue;

  @ApiProperty({ example: '推广奖励 · 张三订阅季度会员', description: '纯利豆流水说明' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ example: 'promo-21', description: '关联推广记录 ID' })
  @IsOptional()
  @IsString()
  relatedPromoId?: string;

  @ApiPropertyOptional({ example: '张三', description: '关联被推广用户' })
  @IsOptional()
  @IsString()
  relatedUser?: string;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt()
  createdAt: number;
}

export class PulseAdminMemberBeanLogsResponseDto {
  @ApiProperty({
    type: [PulseAdminMemberBeanLogDto],
    description: '管理员视角会员纯利豆流水列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberBeanLogDto)
  items: PulseAdminMemberBeanLogDto[];
}

// ─────────────────────────────────────────────────────────────
// 管理员视角 — 会员列表与详情
// 对齐前端 memberList.types.ts 中的：
//   MemberStatus / MemberLevel / RechargeRecord /
//   MemberListItem / MemberDetail
// ─────────────────────────────────────────────────────────────

/**
 * 会员状态（对齐前端 MemberStatus）
 */
export const PULSE_MEMBER_STATUS_VALUES = [
  'active',
  'inactive',
  'banned',
] as const;
export type PulseMemberStatusValue =
  (typeof PULSE_MEMBER_STATUS_VALUES)[number];

/**
 * 会员等级（对齐前端 MemberLevel）
 */
export const PULSE_MEMBER_LEVEL_VALUES = [
  'free',
  'monthly',
  'quarterly',
  'annual',
  'lifetime',
] as const;
export type PulseMemberLevelValue =
  (typeof PULSE_MEMBER_LEVEL_VALUES)[number];

/**
 * 充值支付渠道（对齐前端 RechargeRecord.channel）
 */
export const PULSE_RECHARGE_CHANNEL_VALUES = [
  'wechat',
  'alipay',
  'card',
] as const;
export type PulseRechargeChannelValue =
  (typeof PULSE_RECHARGE_CHANNEL_VALUES)[number];

/**
 * 充值记录（对齐前端 RechargeRecord）
 */
export class PulseRechargeRecordDto {
  @ApiProperty({ example: 'rc-001', description: '充值记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '年卡会员', description: '套餐名称' })
  @IsString()
  planName: string;

  @ApiProperty({ example: 29800, description: '充值金额（分）' })
  @IsInt()
  amount: number;

  @ApiProperty({
    example: 500,
    description: '积分奖励（对齐前端 RechargeRecord.pointsAwarded）',
  })
  @IsInt()
  pointsAwarded: number;

  @ApiProperty({
    enum: PULSE_RECHARGE_CHANNEL_VALUES,
    example: 'wechat',
    description: '支付渠道：wechat=微信 / alipay=支付宝 / card=银行卡（对齐前端 RechargeRecord.channel）',
  })
  @IsIn(PULSE_RECHARGE_CHANNEL_VALUES)
  channel: PulseRechargeChannelValue;

  @ApiProperty({ example: 1747123200000, description: '充值时间戳（ms）' })
  @IsInt()
  createdAt: number;
}

/**
 * 管理员视角的会员列表条目（轻量）
 * 对齐前端 MemberListItem（memberList.types.ts）
 */
export class PulseMemberListItemDto {
  @ApiProperty({ example: 'm001', description: '会员 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '刘梅', description: '会员姓名' })
  @IsString()
  name: string;

  @ApiProperty({ example: '138****9021', description: '会员手机号（脱敏）' })
  @IsString()
  phone: string;

  @ApiProperty({
    example: '刘',
    description: '头像文字（姓名首字，对齐前端 MemberListItem.avatarChar）',
  })
  @IsString()
  avatarChar: string;

  @ApiProperty({
    example: 0,
    description: '头像颜色索引 0-5（对齐前端 MemberListItem.avatarColorIdx）',
  })
  @IsInt()
  avatarColorIdx: number;

  @ApiProperty({
    enum: PULSE_MEMBER_STATUS_VALUES,
    example: 'active',
    description: '会员状态：active=正常 / inactive=未活跃 / banned=已封禁',
  })
  @IsIn(PULSE_MEMBER_STATUS_VALUES)
  status: PulseMemberStatusValue;

  @ApiProperty({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    example: 'annual',
    description: '会员等级：free=免费 / monthly=月卡 / quarterly=季卡 / annual=年卡 / lifetime=永久',
  })
  @IsIn(PULSE_MEMBER_LEVEL_VALUES)
  level: PulseMemberLevelValue;

  @ApiProperty({ example: 1280, description: '当前积分余额' })
  @IsInt()
  availablePoints: number;

  @ApiProperty({ example: 0, description: '纯利豆余额' })
  @IsInt()
  beanBalance: number;

  @ApiProperty({ example: false, description: '是否是合伙人' })
  @IsBoolean()
  isPartner: boolean;

  @ApiProperty({ example: 59800, description: '累计充值金额（分）' })
  @IsInt()
  totalRecharged: number;

  @ApiProperty({ example: 1747123200000, description: '注册时间戳（ms）' })
  @IsInt()
  registeredAt: number;

  @ApiProperty({ example: 1747209600000, description: '最近活跃时间戳（ms）' })
  @IsInt()
  lastActiveAt: number;
}

/**
 * 管理员视角的会员详情
 * 对齐前端 MemberDetail（memberList.types.ts）
 */
export class PulseMemberDetailDto {
  @ApiProperty({ example: 'm001', description: '会员 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '刘梅', description: '会员姓名' })
  @IsString()
  name: string;

  @ApiProperty({ example: '138****9021', description: '会员手机号（脱敏）' })
  @IsString()
  phone: string;

  @ApiProperty({
    example: '刘',
    description: '头像文字（姓名首字，对齐前端 MemberDetail.avatarChar）',
  })
  @IsString()
  avatarChar: string;

  @ApiProperty({
    example: 0,
    description: '头像颜色索引 0-5（对齐前端 MemberDetail.avatarColorIdx）',
  })
  @IsInt()
  avatarColorIdx: number;

  @ApiProperty({
    enum: PULSE_MEMBER_STATUS_VALUES,
    example: 'active',
    description: '会员状态',
  })
  @IsIn(PULSE_MEMBER_STATUS_VALUES)
  status: PulseMemberStatusValue;

  @ApiProperty({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    example: 'annual',
    description: '会员等级',
  })
  @IsIn(PULSE_MEMBER_LEVEL_VALUES)
  level: PulseMemberLevelValue;

  @ApiProperty({ example: 1747123200000, description: '注册时间戳（ms）' })
  @IsInt()
  registeredAt: number;

  @ApiProperty({ example: 1747209600000, description: '最近活跃时间戳（ms）' })
  @IsInt()
  lastActiveAt: number;

  @ApiProperty({ example: 1280, description: '当前积分余额' })
  @IsInt()
  availablePoints: number;

  @ApiProperty({
    example: 2800,
    description: '历史累计积分（对齐前端 MemberDetail.totalPointsEarned）',
  })
  @IsInt()
  totalPointsEarned: number;

  @ApiProperty({ example: 0, description: '纯利豆余额' })
  @IsInt()
  beanBalance: number;

  @ApiProperty({ example: false, description: '是否是合伙人' })
  @IsBoolean()
  isPartner: boolean;

  @ApiPropertyOptional({
    example: 'P2',
    description: '合伙人等级，非合伙人时为空',
  })
  @IsOptional()
  @IsString()
  partnerLevel?: string;

  @ApiProperty({ example: 59800, description: '累计充值金额（分）' })
  @IsInt()
  totalRecharged: number;

  @ApiProperty({
    example: 3,
    description: '充值次数（对齐前端 MemberDetail.rechargeCount）',
  })
  @IsInt()
  rechargeCount: number;

  @ApiProperty({
    example: 2,
    description: '推广带来的新用户数（对齐前端 MemberDetail.invitedCount）',
  })
  @IsInt()
  invitedCount: number;

  @ApiProperty({
    type: [PulseRechargeRecordDto],
    description: '充值记录列表（对齐前端 MemberDetail.rechargeHistory）',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseRechargeRecordDto)
  rechargeHistory: PulseRechargeRecordDto[];

  @ApiPropertyOptional({
    example: '老会员，优先服务',
    description: '备注（对齐前端 MemberDetail.remark）',
  })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '会员到期时间戳（ms），永久会员为 null（对齐前端 MemberDetail.membershipExpiry）',
  })
  @IsOptional()
  @IsInt()
  membershipExpiry?: number | null;
}

export class PulseAdminMemberMembershipDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ enum: PULSE_MEMBER_LEVEL_VALUES, description: '目标会员等级' })
  @IsOptional()
  @IsIn(PULSE_MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  level?: PulseMemberLevelValue;

  @ApiPropertyOptional({ enum: PULSE_MEMBER_LEVEL_VALUES, description: '兼容旧请求的会员等级字段' })
  @IsOptional()
  @IsIn(PULSE_MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  memberLevel?: PulseMemberLevelValue;

  @ApiPropertyOptional({ enum: PULSE_MEMBER_LEVEL_VALUES, description: '兼容旧请求的会员等级字段' })
  @IsOptional()
  @IsIn(PULSE_MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  membershipLevel?: PulseMemberLevelValue;

  @ApiPropertyOptional({ example: 1747209600000, description: '会员到期时间戳（ms）' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') {
      return value ?? undefined;
    }
    return Number(value);
  })
  @IsInt({ message: '会员到期时间必须是整数时间戳' })
  membershipExpiry?: number | null;

  @ApiPropertyOptional({ example: 1747209600000, description: '兼容旧请求的到期时间字段' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') {
      return value ?? undefined;
    }
    return Number(value);
  })
  @IsInt({ message: '会员到期时间必须是整数时间戳' })
  expireAt?: number | null;

  @ApiPropertyOptional({ example: 1747209600000, description: '兼容旧请求的到期时间字段' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') {
      return value ?? undefined;
    }
    return Number(value);
  })
  @IsInt({ message: '会员到期时间必须是整数时间戳' })
  expiryAt?: number | null;
}

export class PulseAdminMemberStatusDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ enum: PULSE_MEMBER_STATUS_VALUES, description: '目标会员状态' })
  @IsOptional()
  @IsIn(PULSE_MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  status?: PulseMemberStatusValue;

  @ApiPropertyOptional({ enum: PULSE_MEMBER_STATUS_VALUES, description: '兼容旧请求的会员状态字段' })
  @IsOptional()
  @IsIn(PULSE_MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  memberStatus?: PulseMemberStatusValue;

  @ApiPropertyOptional({ example: '涉嫌异常操作', description: '操作原因' })
  @IsOptional()
  @IsString({ message: '操作原因必须是字符串' })
  @MaxLength(100, { message: '操作原因最多 100 位' })
  reason?: string;

  @ApiPropertyOptional({ example: '涉嫌异常操作', description: '兼容旧请求的备注字段' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 位' })
  remark?: string;
}

/**
 * 会员列表筛选状态（对齐前端 MemberFilterStatus / MemberFilterLevel）
 */
export const PULSE_MEMBER_FILTER_STATUS_VALUES = [
  'all',
  'active',
  'inactive',
  'banned',
] as const;
export type PulseMemberFilterStatusValue =
  (typeof PULSE_MEMBER_FILTER_STATUS_VALUES)[number];

export const PULSE_MEMBER_FILTER_LEVEL_VALUES = [
  'all',
  'free',
  'monthly',
  'quarterly',
  'annual',
  'lifetime',
] as const;
export type PulseMemberFilterLevelValue =
  (typeof PULSE_MEMBER_FILTER_LEVEL_VALUES)[number];

/**
 * GET /pulse/membership/admin/members
 * 管理员获取会员列表 — 查询参数
 */
export class GetPulseAdminMembersQueryDto {
  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_STATUS_VALUES,
    description: '会员状态筛选，不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_STATUS_VALUES, { message: '会员状态筛选不合法' })
  status?: PulseMemberFilterStatusValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_LEVEL_VALUES,
    description: '会员等级筛选，不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_LEVEL_VALUES, { message: '会员等级筛选不合法' })
  level?: PulseMemberFilterLevelValue;

  @ApiPropertyOptional({
    example: true,
    description: '是否仅返回合伙人，兼容 partner=true 查询',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') {
      return true;
    }
    if (value === false || value === 'false') {
      return false;
    }
    return undefined;
  })
  @IsBoolean({ message: '合伙人筛选标记必须是布尔值' })
  partner?: boolean;

  @ApiPropertyOptional({
    example: '刘梅',
    description: '搜索关键词（姓名 / 手机号）',
  })
  @IsOptional()
  @IsString({ message: '搜索关键词必须是字符串' })
  keyword?: string;
}

/**
 * 管理员会员列表响应
 */
export class PulseAdminMembersResponseDto {
  @ApiProperty({
    type: [PulseMemberListItemDto],
    description: '会员列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseMemberListItemDto)
  items: PulseMemberListItemDto[];

  @ApiProperty({ example: 158, description: '会员总数' })
  @IsInt()
  total: number;
}
