import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PlatformMembershipApprovedPartnerDto } from '../../../purely-profit/member/platform-membership/dto/platform-membership-response.dto';
import {
  PARTNER_WITHDRAWAL_STATUS_VALUES,
  WITHDRAWAL_ACCOUNT_TYPE_VALUES,
} from '../../../purely-profit/member/withdrawals/dto/apply-withdrawal.dto';
import type {
  PartnerWithdrawalStatusValue,
  WithdrawalAccountTypeValue,
} from '../../../purely-profit/member/withdrawals/dto/apply-withdrawal.dto';

// ─────────────────────────────────────────────────────────────
// 公共工具
// ─────────────────────────────────────────────────────────────

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

// ─────────────────────────────────────────────────────────────
// 收益总览响应
// ─────────────────────────────────────────────────────────────

export class PulseEarningsOverviewResponseDto {
  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '兼容旧前端的主合伙人摘要',
  })
  @IsOptional()
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;

  @ApiProperty({
    type: [PlatformMembershipApprovedPartnerDto],
    description: '当前门店全部正式合伙人列表',
  })
  approvedPartners: PlatformMembershipApprovedPartnerDto[];

  @ApiProperty({ example: 1200, description: '当前纯利豆余额（聚合）' })
  @IsInt()
  beanBalance: number;

  @ApiProperty({ example: 3000, description: '累计获得纯利豆总量' })
  @IsInt()
  totalEarnedBeans: number;

  @ApiProperty({ example: 1800, description: '累计提现纯利豆总量' })
  @IsInt()
  totalWithdrawnBeans: number;

  @ApiProperty({ example: 15, description: '推广总人数（累计注册人数）' })
  @IsInt()
  totalPromos: number;

  @ApiProperty({ example: 8, description: '推广付费人数（已订阅套餐）' })
  @IsInt()
  chargedPromos: number;

  @ApiProperty({ example: false, description: '是否已成为合伙人' })
  isPartner: boolean;

  @ApiProperty({ example: 2, description: '处理中提现申请数量' })
  @IsInt()
  pendingWithdrawals: number;
}

// ─────────────────────────────────────────────────────────────
// 收益明细查询
// ─────────────────────────────────────────────────────────────

export const PULSE_EARNINGS_LOG_TYPE_VALUES = [
  'all',
  'earn',
  'spend',
  'withdraw',
] as const;
export type PulseEarningsLogTypeValue =
  (typeof PULSE_EARNINGS_LOG_TYPE_VALUES)[number];
export const PULSE_EARNINGS_LOG_DEFAULT_LIMIT = 20;
export const PULSE_EARNINGS_LOG_MAX_LIMIT = 100;

export class GetPulseEarningsLogsQueryDto {
  @ApiPropertyOptional({
    enum: PULSE_EARNINGS_LOG_TYPE_VALUES,
    description: '流水类型筛选，不传时返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_EARNINGS_LOG_TYPE_VALUES, { message: '流水类型不合法' })
  type?: PulseEarningsLogTypeValue;

  @ApiPropertyOptional({
    example: '1747123200000_128',
    description: '游标分页标记；不传时走兼容模式，传入后按 cursor 分页读取',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'cursor 必须是字符串' })
  @MaxLength(64, { message: 'cursor 最长 64 位' })
  cursor?: string;

  @ApiPropertyOptional({
    example: 20,
    description: 'cursor 模式每页条数，默认 20，最大 100',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : Number(value),
  )
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 必须大于等于 1' })
  @Max(PULSE_EARNINGS_LOG_MAX_LIMIT, {
    message: `limit 不能超过 ${PULSE_EARNINGS_LOG_MAX_LIMIT}`,
  })
  limit?: number;
}

// ─────────────────────────────────────────────────────────────
// 收益明细条目
// ─────────────────────────────────────────────────────────────

export const PULSE_BEAN_SOURCE_VALUES = [
  'promo_reward',
  'deduct_payment',
  'withdrawal',
  'admin_adjust',
] as const;
export const PULSE_BEAN_TYPE_VALUES = ['earn', 'spend', 'withdraw'] as const;
export type PulseBeanTypeValue = (typeof PULSE_BEAN_TYPE_VALUES)[number];

export class PulseEarningsLogItemDto {
  @ApiProperty({ example: 'bean-12', description: '流水 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'u002', description: '用户 ID' })
  @IsString()
  userId: string;

  @ApiProperty({ example: '陈建国', description: '用户姓名（脱敏）' })
  @IsString()
  userName: string;

  @ApiProperty({ example: '139****5566', description: '用户手机号（脱敏）' })
  @IsString()
  userPhone: string;

  @ApiProperty({
    example: 10,
    description: '变动纯利豆数量（正=收入，负=支出）',
  })
  @IsInt()
  amount: number;

  @ApiProperty({
    enum: PULSE_BEAN_TYPE_VALUES,
    description: '流水方向：earn=收入 / spend=支出 / withdraw=提现',
  })
  @IsIn(PULSE_BEAN_TYPE_VALUES)
  type: PulseBeanTypeValue;

  @ApiProperty({
    enum: PULSE_BEAN_SOURCE_VALUES,
    description: '来源：推广奖励 / 抵扣消费 / 提现 / 后台调整',
  })
  @IsIn(PULSE_BEAN_SOURCE_VALUES)
  source: string;

  @ApiProperty({
    example: '推广奖励 · 张三订阅季度会员',
    description: '流水说明',
  })
  @IsString()
  description: string;

  @ApiPropertyOptional({
    example: 'promo-21',
    description: '关联推广记录 ID（promo_reward 时存在）',
  })
  @IsOptional()
  @IsString()
  relatedPromoId?: string;

  @ApiPropertyOptional({
    example: '张宇',
    description: '关联被推广用户名（promo_reward 时存在）',
  })
  @IsOptional()
  @IsString()
  relatedUser?: string;

  @ApiProperty({ example: 1747123200000, description: '产生时间戳（ms）' })
  @IsInt()
  createdAt: number;
}

export class PulseEarningsLogsResponseDto {
  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '兼容旧前端的主合伙人摘要',
  })
  @IsOptional()
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;

  @ApiProperty({
    type: [PlatformMembershipApprovedPartnerDto],
    description: '当前门店全部正式合伙人列表',
  })
  approvedPartners: PlatformMembershipApprovedPartnerDto[];

  @ApiProperty({ type: [PulseEarningsLogItemDto], description: '收益流水列表' })
  items: PulseEarningsLogItemDto[];

  @ApiProperty({ example: 1200, description: '当前纯利豆余额（聚合）' })
  @IsInt()
  beanBalance: number;

  @ApiProperty({ example: false, description: '是否还有下一页' })
  hasMore: boolean;

  @ApiPropertyOptional({
    example: '1747123200000_128',
    description: '下一页 cursor；没有更多数据时为 null',
  })
  @IsOptional()
  nextCursor: string | null;
}

// ─────────────────────────────────────────────────────────────
// 提现账户信息响应
// ─────────────────────────────────────────────────────────────

export class PulseWithdrawalAccountPartnerDto extends PlatformMembershipApprovedPartnerDto {
  @ApiPropertyOptional({
    enum: WITHDRAWAL_ACCOUNT_TYPE_VALUES,
    example: 'alipay',
    description: '该正式合伙人的收款方式，未设置时为 null',
  })
  @IsOptional()
  @IsIn(WITHDRAWAL_ACCOUNT_TYPE_VALUES)
  accountType: WithdrawalAccountTypeValue | null;

  @ApiPropertyOptional({
    example: '13800138000',
    description: '该正式合伙人的收款账号，未设置时为 null',
  })
  @IsOptional()
  @IsString()
  accountNo: string | null;

  @ApiPropertyOptional({
    example: '张三',
    description: '该正式合伙人的收款人姓名，未设置时为 null',
  })
  @IsOptional()
  @IsString()
  accountName: string | null;
}

export class PulseWithdrawalAccountResponseDto {
  @ApiProperty({ example: false, description: '是否已成为审核通过的合伙人' })
  isPartner: boolean;

  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '兼容旧前端的主合伙人摘要',
  })
  @IsOptional()
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;

  @ApiPropertyOptional({
    type: PulseWithdrawalAccountPartnerDto,
    description: '兼容旧前端的主合伙人提现账户信息',
  })
  @IsOptional()
  selectedPartner: PulseWithdrawalAccountPartnerDto | null;

  @ApiProperty({
    type: [PlatformMembershipApprovedPartnerDto],
    description: '当前门店全部正式合伙人列表',
  })
  approvedPartners: PlatformMembershipApprovedPartnerDto[];

  @ApiPropertyOptional({
    enum: WITHDRAWAL_ACCOUNT_TYPE_VALUES,
    example: 'alipay',
    description: '当前收款方式，未设置时为 null',
  })
  @IsOptional()
  @IsIn(WITHDRAWAL_ACCOUNT_TYPE_VALUES)
  accountType: WithdrawalAccountTypeValue | null;

  @ApiPropertyOptional({
    example: '13800138000',
    description: '当前收款账号，未设置时为 null',
  })
  @IsOptional()
  @IsString()
  accountNo: string | null;

  @ApiPropertyOptional({
    example: '张三',
    description: '收款人真实姓名，未设置时为 null',
  })
  @IsOptional()
  @IsString()
  accountName: string | null;

  @ApiProperty({ example: 1200, description: '当前纯利豆余额（聚合）' })
  @IsInt()
  beanBalance: number;
}

// ─────────────────────────────────────────────────────────────
// 更新提现账户 DTO
// ─────────────────────────────────────────────────────────────

export const PULSE_WITHDRAWAL_MIN_BEANS = 100;
export const PULSE_WITHDRAWAL_MAX_BEANS = 10000;

export class UpdatePulseWithdrawalAccountDto {
  @ApiProperty({
    enum: WITHDRAWAL_ACCOUNT_TYPE_VALUES,
    example: 'alipay',
    description: '收款账户类型',
  })
  @IsIn(WITHDRAWAL_ACCOUNT_TYPE_VALUES, { message: '收款方式不合法' })
  accountType: WithdrawalAccountTypeValue;

  @ApiProperty({ example: '13800138000', description: '收款账号' })
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '收款账号必须是字符串' })
  @MaxLength(64, { message: '收款账号最多 64 位' })
  accountNo: string;

  @ApiProperty({ example: '张三', description: '收款人真实姓名' })
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '真实姓名必须是字符串' })
  @MaxLength(32, { message: '真实姓名最多 32 位' })
  accountName: string;
}

// ─────────────────────────────────────────────────────────────
// 申请提现 DTO
// ─────────────────────────────────────────────────────────────

export class PulseApplyWithdrawalDto {
  @ApiPropertyOptional({
    example: '12',
    description: '指定提现的正式合伙人 ID；不传时默认按主合伙人处理',
  })
  @IsOptional()
  @IsString({ message: '合伙人 ID 必须是字符串' })
  partnerId?: string;

  @ApiProperty({
    example: 100,
    description: '提现纯利豆数量（整数豆）',
  })
  @IsInt({ message: '提现数量必须是整数' })
  @Min(PULSE_WITHDRAWAL_MIN_BEANS, {
    message: `最低提现 ${PULSE_WITHDRAWAL_MIN_BEANS} 豆`,
  })
  @Max(PULSE_WITHDRAWAL_MAX_BEANS, {
    message: `单次最多提现 ${PULSE_WITHDRAWAL_MAX_BEANS} 豆`,
  })
  beanAmount: number;
}

// ─────────────────────────────────────────────────────────────
// 管理员打款管理（合伙人提现申请列表 — 管理员视角）
// 对齐前端 PayoutApplication 类型
// ─────────────────────────────────────────────────────────────

/**
 * GET /pulse/growth/admin/payouts（管理员获取合伙人打款申请列表）
 * 筛选参数
 */
export const PULSE_PAYOUT_TAB_VALUES = [
  'all',
  'pending',
  'paid',
  'rejected',
] as const;
export type PulsePayoutTabValue = (typeof PULSE_PAYOUT_TAB_VALUES)[number];
export const PULSE_ADMIN_PAYOUT_DEFAULT_LIMIT = 20;
export const PULSE_ADMIN_PAYOUT_MAX_LIMIT = 100;

export class GetPulseAdminPayoutsQueryDto {
  @ApiPropertyOptional({
    enum: PULSE_PAYOUT_TAB_VALUES,
    description: '状态筛选：全部 / 待处理 / 已打款 / 已拒绝，不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_PAYOUT_TAB_VALUES, { message: '状态筛选不合法' })
  tab?: PulsePayoutTabValue;

  @ApiPropertyOptional({
    example: '1747123200000_128',
    description:
      '游标分页标记；不传时返回当前筛选下全量结果，传入后按 cursor 继续翻页',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'cursor 必须是字符串' })
  @MaxLength(64, { message: 'cursor 最长 64 位' })
  cursor?: string;

  @ApiPropertyOptional({
    example: 20,
    description: 'cursor 模式每页条数，默认 20，最大 100',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : Number(value),
  )
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 必须大于等于 1' })
  @Max(PULSE_ADMIN_PAYOUT_MAX_LIMIT, {
    message: `limit 不能超过 ${PULSE_ADMIN_PAYOUT_MAX_LIMIT}`,
  })
  limit?: number;
}

/**
 * 管理员视角的打款申请条目
 * 对齐前端 PayoutApplication：
 *   id / partnerName / partnerPhone / partnerCity /
 *   amount / accountType / accountNo / accountName /
 *   status / appliedAt / paidAt / txnNo / rejectReason
 */
export class PulsePayoutApplicationItemDto {
  @ApiProperty({ example: 'pay-001', description: '打款申请 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '张伟', description: '合伙人姓名' })
  @IsString()
  partnerName: string;

  @ApiProperty({ example: '138****8821', description: '合伙人手机号（脱敏）' })
  @IsString()
  partnerPhone: string;

  @ApiProperty({ example: '上海', description: '合伙人所在城市' })
  @IsString()
  partnerCity: string;

  @ApiProperty({ example: 2000, description: '申请提现金额（分）' })
  @IsInt()
  amount: number;

  @ApiProperty({
    enum: WITHDRAWAL_ACCOUNT_TYPE_VALUES,
    example: 'alipay',
    description: '收款方式：wechat=微信 / alipay=支付宝 / bank=银行卡',
  })
  @IsIn(WITHDRAWAL_ACCOUNT_TYPE_VALUES)
  accountType: WithdrawalAccountTypeValue;

  @ApiProperty({ example: '138****8821', description: '收款账号' })
  @IsString()
  accountNo: string;

  @ApiProperty({ example: '张伟', description: '收款人真实姓名' })
  @IsString()
  accountName: string;

  @ApiProperty({
    enum: PARTNER_WITHDRAWAL_STATUS_VALUES,
    example: 'pending',
    description:
      '申请状态：pending=待处理 / approved=审核中 / paid=已打款 / rejected=已拒绝',
  })
  @IsIn(PARTNER_WITHDRAWAL_STATUS_VALUES)
  status: PartnerWithdrawalStatusValue;

  @ApiProperty({
    example: '2026-04-29 16:42',
    description:
      '申请时间（格式 YYYY-MM-DD HH:mm，对齐前端 PayoutApplication.appliedAt）',
  })
  @IsString()
  appliedAt: string;

  @ApiPropertyOptional({
    example: '2026-04-28 09:12',
    description: '打款时间（格式 YYYY-MM-DD HH:mm），已打款时存在',
  })
  @IsOptional()
  @IsString()
  paidAt: string | null;

  @ApiPropertyOptional({
    example: 'TXN20260428001',
    description: '打款流水号，已打款时存在',
  })
  @IsOptional()
  @IsString()
  txnNo: string | null;

  @ApiPropertyOptional({
    example: '银行卡账号信息有误，请重新提交',
    description: '拒绝原因，已拒绝时存在',
  })
  @IsOptional()
  @IsString()
  rejectReason: string | null;
}

export class PulseAdminPayoutsResponseDto {
  @ApiProperty({
    type: [PulsePayoutApplicationItemDto],
    description: '打款申请列表',
  })
  items: PulsePayoutApplicationItemDto[];

  @ApiProperty({ example: 3, description: '待处理申请数' })
  @IsInt()
  pendingCount: number;

  @ApiProperty({ example: 4300, description: '待打款总金额（分）' })
  @IsInt()
  pendingTotal: number;

  @ApiProperty({ example: 2000, description: '已打款累计金额（分）' })
  @IsInt()
  paidTotal: number;

  @ApiProperty({ example: false, description: '是否还有下一页' })
  hasMore: boolean;

  @ApiPropertyOptional({
    example: '1747123200000_128',
    description: '下一页 cursor；没有更多数据时为 null',
  })
  @IsOptional()
  nextCursor: string | null;
}

/**
 * PATCH /pulse/growth/admin/payouts/:id/approve
 * 管理员确认打款
 */
export class PulseAdminApprovePayoutDto {
  @ApiPropertyOptional({
    example: 'TXN20260428001',
    description: '打款流水号（可选，已有第三方流水号时传入）',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '流水号必须是字符串' })
  @MaxLength(64, { message: '流水号最多 64 位' })
  txnNo?: string;
}

/**
 * PATCH /pulse/growth/admin/payouts/:id/reject
 * 管理员拒绝打款
 */
export class PulseAdminRejectPayoutDto {
  @ApiProperty({
    example: '银行卡账号信息有误，请重新提交',
    description: '拒绝原因',
  })
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '拒绝原因必须是字符串' })
  @MaxLength(200, { message: '拒绝原因最多 200 字' })
  rejectReason: string;
}

// ─────────────────────────────────────────────────────────────
// 管理员合伙人申请审核（合伙人申请列表 — 管理员视角）
// 对齐前端 PartnerApplication 类型（partnerReview.tsx）
// ─────────────────────────────────────────────────────────────

export const PULSE_PARTNER_APPLICATION_STATUS_VALUES = [
  'pending',
  'approved',
  'rejected',
] as const;
export type PulsePartnerApplicationStatusValue =
  (typeof PULSE_PARTNER_APPLICATION_STATUS_VALUES)[number];

export const PULSE_PARTNER_REVIEW_TAB_VALUES = [
  'all',
  'pending',
  'approved',
  'rejected',
] as const;
export type PulsePartnerReviewTabValue =
  (typeof PULSE_PARTNER_REVIEW_TAB_VALUES)[number];
export const PULSE_ADMIN_PARTNER_APPLICATION_DEFAULT_LIMIT = 20;
export const PULSE_ADMIN_PARTNER_APPLICATION_MAX_LIMIT = 100;

/**
 * GET /pulse/growth/admin/partner-applications
 * 管理员获取合伙人申请列表 — 查询参数
 */
export class GetPulseAdminPartnerApplicationsQueryDto {
  @ApiPropertyOptional({
    enum: PULSE_PARTNER_REVIEW_TAB_VALUES,
    description: '状态筛选：全部 / 待审核 / 已通过 / 已拒绝，不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_PARTNER_REVIEW_TAB_VALUES, { message: '状态筛选不合法' })
  tab?: PulsePartnerReviewTabValue;

  @ApiPropertyOptional({
    example: '1747123200000_128',
    description:
      '游标分页标记；不传时返回当前筛选下全量结果，传入后按 cursor 继续翻页',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'cursor 必须是字符串' })
  @MaxLength(64, { message: 'cursor 最长 64 位' })
  cursor?: string;

  @ApiPropertyOptional({
    example: 20,
    description: 'cursor 模式每页条数，默认 20，最大 100',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : Number(value),
  )
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 必须大于等于 1' })
  @Max(PULSE_ADMIN_PARTNER_APPLICATION_MAX_LIMIT, {
    message: `limit 不能超过 ${PULSE_ADMIN_PARTNER_APPLICATION_MAX_LIMIT}`,
  })
  limit?: number;
}

/**
 * 管理员视角的合伙人申请条目
 * 对齐前端 PartnerApplication（partnerReview.tsx）：
 *   id / name / phone / city / appliedAt(string) /
 *   reason / avatar / status
 */
export class PulseAdminPartnerApplicationItemDto {
  @ApiProperty({ example: 'app-001', description: '申请记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '刘梅', description: '申请人姓名' })
  @IsString()
  name: string;

  @ApiProperty({ example: '138****9021', description: '申请人手机号（脱敏）' })
  @IsString()
  phone: string;

  @ApiProperty({ example: '深圳', description: '申请人所在城市' })
  @IsString()
  city: string;

  @ApiProperty({
    example: '2026-04-19 14:32',
    description:
      '申请时间（格式 YYYY-MM-DD HH:mm，对齐前端 PartnerApplication.appliedAt）',
  })
  @IsString()
  appliedAt: string;

  @ApiProperty({
    example: '我有稳定的客户资源，在健身行业深耕5年...',
    description: '申请理由（对齐前端 PartnerApplication.reason）',
  })
  @IsString()
  reason: string;

  @ApiProperty({
    example: '刘',
    description: '头像文字（姓名首字，对齐前端 PartnerApplication.avatar）',
  })
  @IsString()
  avatar: string;

  @ApiProperty({
    enum: PULSE_PARTNER_APPLICATION_STATUS_VALUES,
    example: 'pending',
    description: '申请状态：pending=待审核 / approved=已通过 / rejected=已拒绝',
  })
  @IsIn(PULSE_PARTNER_APPLICATION_STATUS_VALUES)
  status: PulsePartnerApplicationStatusValue;
}

export class PulseAdminPartnerApplicationsResponseDto {
  @ApiProperty({
    type: [PulseAdminPartnerApplicationItemDto],
    description: '合伙人申请列表',
  })
  items: PulseAdminPartnerApplicationItemDto[];

  @ApiProperty({ example: 5, description: '待审核申请数' })
  @IsInt()
  pendingCount: number;

  @ApiProperty({ example: 3, description: '已通过申请数' })
  @IsInt()
  approvedCount: number;

  @ApiProperty({ example: 2, description: '已拒绝申请数' })
  @IsInt()
  rejectedCount: number;

  @ApiProperty({ example: false, description: '是否还有下一页' })
  hasMore: boolean;

  @ApiPropertyOptional({
    example: '1747123200000_128',
    description: '下一页 cursor；没有更多数据时为 null',
  })
  @IsOptional()
  nextCursor: string | null;
}

/**
 * PATCH /pulse/growth/admin/partner-applications/:id/approve
 * 管理员通过合伙人申请
 */
export class PulseAdminApprovePartnerApplicationDto {
  @ApiPropertyOptional({
    example: '资料齐全，欢迎加入',
    description: '审批备注（可选）',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最多 200 字' })
  note?: string;
}

/**
 * PATCH /pulse/growth/admin/partner-applications/:id/reject
 * 管理员拒绝合伙人申请
 */
export class PulseAdminRejectPartnerApplicationDto {
  @ApiProperty({
    example: '资料暂不完整，请补充后重新申请',
    description: '拒绝原因',
  })
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '拒绝原因必须是字符串' })
  @MaxLength(500, { message: '拒绝原因最多 500 字' })
  reason: string;
}
