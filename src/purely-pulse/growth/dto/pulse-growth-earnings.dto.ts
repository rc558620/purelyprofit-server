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
  WITHDRAWAL_ACCOUNT_TYPE_VALUES,
} from '../../../purely-profit/member/withdrawals/dto/apply-withdrawal.dto';
import type {
  WithdrawalAccountTypeValue,
} from '../../../purely-profit/member/withdrawals/dto/apply-withdrawal.dto';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

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
