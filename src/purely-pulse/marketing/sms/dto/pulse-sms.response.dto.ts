// Pulse / 群发短信管理响应 DTO
//
// 💰 金额字段一律 Int 分，与 `sms.prisma` 及 purelyProfit `/marketing/sms` 同源。
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

/** 门店短信账户现状（身份展示门店主账号，而非门店名） */
export class PulseAdminSmsAccountDto {
  @ApiProperty({ example: '1', description: '门店 ID' })
  @IsString()
  storeId: string;

  @ApiProperty({ example: '纯利宝南山店', description: '门店名称' })
  @IsString()
  storeName: string;

  @ApiProperty({ example: '张三', description: '主账号昵称' })
  @IsString()
  ownerName: string;

  @ApiProperty({
    example: '13800138000',
    description: '主账号手机号，取不到时为空串',
  })
  @IsString()
  ownerPhone: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar.jpg',
    description: '主账号头像 URL，未设置时为空串',
  })
  @IsOptional()
  @IsString()
  ownerAvatarUrl?: string;

  @ApiProperty({ example: 12000, description: '可用余额（分）' })
  @IsInt()
  balanceFen: number;

  @ApiProperty({ example: 5000, description: '累计充值（分，不含平台赠送）' })
  @IsInt()
  totalRechargedFen: number;

  @ApiProperty({ example: 3600, description: '累计消费（分）' })
  @IsInt()
  totalConsumedFen: number;

  @ApiProperty({
    example: 720,
    description: '累计发送成功的短信条数（计费条数口径）',
  })
  @IsInt()
  sentSmsCount: number;

  @ApiProperty({ example: 500, description: '余额预警阈值（分）' })
  @IsInt()
  warningThresholdFen: number;

  @ApiPropertyOptional({
    example: 1747123200000,
    description: '账户最近更新时间戳（ms）；门店尚无短信账户时为 null',
  })
  @IsOptional()
  @IsInt()
  updatedAt?: number | null;
}

/**
 * 短信账户统计概览（后端权威计算，前端仅展示）。
 *
 * 统计口径为**当前搜索关键词过滤后的完整门店集合**：与分页切片无关，
 * 也不随健康度 Tab 变化（切到「已耗尽」时概览仍展示全局口径，避免恒为 0）。
 */
export class PulseAdminSmsAccountsStatsDto {
  @ApiProperty({ example: 12, description: '当前筛选条件下的门店总数' })
  @IsInt()
  storeCount: number;

  @ApiProperty({ example: 996200, description: '短信余额合计（分）' })
  @IsInt()
  totalBalanceFen: number;

  @ApiProperty({ example: 0, description: '余额预警门店数' })
  @IsInt()
  warningCount: number;

  @ApiProperty({ example: 0, description: '余额已耗尽门店数（未赠送不计入）' })
  @IsInt()
  exhaustedCount: number;
}

/** 门店群发任务（平台运营视角：用来找失败任务并退费） */
export class PulseAdminSmsBroadcastDto {
  @ApiProperty({
    example: 'bc_1a2b3c4d5e6f7081',
    description: '群发任务业务 ID',
  })
  @IsString()
  broadcastId: string;

  @ApiProperty({ example: '老顾客回馈：本周到店满 100 减 20。' })
  @IsString()
  content: string;

  @ApiProperty({
    example: 'partial_failed',
    description: 'pending / sending / sent / partial_failed / failed',
  })
  @IsString()
  status: string;

  @ApiProperty({ example: 20, description: '收件人数（含无手机号者）' })
  @IsInt()
  recipientCount: number;

  @ApiProperty({ example: 18, description: '有效手机号人数' })
  @IsInt()
  validMobileCount: number;

  @ApiProperty({ example: 16, description: '投递成功人数' })
  @IsInt()
  successCount: number;

  @ApiProperty({ example: 2, description: '投递失败人数' })
  @IsInt()
  failedCount: number;

  @ApiProperty({ example: 90, description: '扣费金额（分）' })
  @IsInt()
  chargedAmountFen: number;

  @ApiProperty({ example: 0, description: '已退费金额（分）；> 0 表示已退过' })
  @IsInt()
  refundedAmountFen: number;

  @ApiProperty({
    example: true,
    description: '当前是否可退费（状态为失败类且尚未退过）',
  })
  @IsBoolean()
  refundable: boolean;

  @ApiPropertyOptional({
    example: 'LimitExceeded.PhoneNumberCountLimit：号码数量超过限制',
    description: '最近一次派发失败原因',
  })
  @IsOptional()
  @IsString()
  lastError?: string | null;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt()
  createdAt: number;
}

export class PulseAdminSmsBroadcastsResponseDto {
  @ApiProperty({
    type: [PulseAdminSmsBroadcastDto],
    description: '当前页群发任务列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminSmsBroadcastDto)
  items: PulseAdminSmsBroadcastDto[];

  @ApiProperty({ example: 12, description: '符合条件的任务总数' })
  @IsInt()
  total: number;

  @ApiProperty({ example: 1, description: '当前页码（从 1 开始）' })
  @IsInt()
  page: number;

  @ApiProperty({ example: 20, description: '每页条数' })
  @IsInt()
  pageSize: number;

  @ApiProperty({ example: false, description: '是否还有下一页' })
  @IsBoolean()
  hasMore: boolean;
}

/** 退费结果 */
export class PulseAdminSmsBroadcastRefundResultDto {
  @ApiProperty({
    example: 'bc_1a2b3c4d5e6f7081',
    description: '群发任务业务 ID',
  })
  @IsString()
  broadcastId: string;

  @ApiProperty({ example: 10, description: '本次退费金额（分）' })
  @IsInt()
  refundedAmountFen: number;

  @ApiProperty({ example: 2, description: '本次退费对应的失败收件人数' })
  @IsInt()
  failedCount: number;

  @ApiProperty({ example: 12800, description: '退费后门店短信余额（分）' })
  @IsInt()
  balanceFen: number;
}

export class PulseAdminSmsAccountsResponseDto {
  @ApiProperty({
    type: [PulseAdminSmsAccountDto],
    description: '当前页门店短信账户列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminSmsAccountDto)
  items: PulseAdminSmsAccountDto[];

  @ApiProperty({ example: 12, description: '当前筛选条件下的门店总数' })
  @IsInt()
  total: number;

  @ApiProperty({ example: 1, description: '当前页码（从 1 开始）' })
  @IsInt()
  page: number;

  @ApiProperty({ example: 20, description: '每页条数' })
  @IsInt()
  pageSize: number;

  @ApiProperty({ example: false, description: '是否还有下一页' })
  @IsBoolean()
  hasMore: boolean;

  @ApiProperty({
    type: PulseAdminSmsAccountsStatsDto,
    description: '统计概览（按当前筛选条件的完整门店集合计算，与分页无关）',
  })
  @ValidateNested()
  @Type(() => PulseAdminSmsAccountsStatsDto)
  stats: PulseAdminSmsAccountsStatsDto;
}
