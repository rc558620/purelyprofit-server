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
import {
  PARTNER_WITHDRAWAL_STATUS_VALUES,
  WITHDRAWAL_ACCOUNT_TYPE_VALUES,
} from '../../../purely-profit/member/withdrawals/dto/apply-withdrawal.dto';
import type {
  PartnerWithdrawalStatusValue,
  WithdrawalAccountTypeValue,
} from '../../../purely-profit/member/withdrawals/dto/apply-withdrawal.dto';
import { PLATFORM_PARTNER_INTENTIONS } from '../../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import type { PlatformPartnerIntention } from '../../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

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

export class PulsePayoutApplicationItemDto {
  @ApiProperty({ example: 'pay-001', description: '打款申请 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '张伟', description: '合伙人姓名' })
  @IsString()
  partnerName: string;

  @ApiProperty({ example: '13800138000', description: '合伙人手机号' })
  @IsString()
  partnerPhone: string;

  @ApiProperty({ example: '上海', description: '合伙人所在城市' })
  @IsString()
  partnerCity: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar.jpg',
    description: '合伙人头像 URL，未设置时为空',
  })
  @IsOptional()
  @IsString()
  partnerAvatarUrl?: string;

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

export class PulseAdminApprovePayoutDto {}

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

export class PulseAdminPartnerApplicationItemDto {
  @ApiProperty({ example: 'app-001', description: '申请记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '刘梅', description: '申请人姓名' })
  @IsString()
  name: string;

  @ApiProperty({ example: '13800138000', description: '申请人手机号' })
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

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar.jpg',
    description: '申请人头像 URL，未设置时为空',
  })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty({
    enum: PLATFORM_PARTNER_INTENTIONS,
    example: 'agent',
    description: '合作意向：agent=代理推广 / invest=投资入股 / resource=资源合作 / other=其他合作',
  })
  @IsIn(PLATFORM_PARTNER_INTENTIONS)
  intention: PlatformPartnerIntention;

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
