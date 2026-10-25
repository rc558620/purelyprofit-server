// Pulse / 群发短信管理请求 DTO
// 供 purelyPulse「群发短信」页面使用：门店短信账户列表 / 平台赠送或回收余额。
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
import { trimString } from '../../../membership/dto/pulse-membership-admin-logs.shared.dto';
import { toNullableNumber } from '../../../membership/dto/pulse-membership-admin-members.transform';
import {
  SMS_BROADCAST_REFUNDABLE_STATUS_VALUES,
  SMS_BROADCAST_STATUS_VALUES,
} from '../../../../purely-profit/marketing/sms/sms.constants';

/** 单次可赠送 / 回收的金额上限（分）= ¥10,000，防止误传天文数字把余额打爆 */
export const PULSE_ADMIN_SMS_MAX_GRANT_FEN = 1_000_000;

/** 短信账户列表健康度筛选值（口径与前端 resolveSmsAccountHealth 一致） */
export const PULSE_ADMIN_SMS_HEALTH_VALUES = ['warning', 'exhausted'] as const;

/** 短信账户列表健康度筛选类型 */
export type PulseAdminSmsHealthFilter =
  (typeof PULSE_ADMIN_SMS_HEALTH_VALUES)[number];

/** 短信账户列表默认单页条数 */
export const PULSE_ADMIN_SMS_DEFAULT_PAGE_SIZE = 20;

/** 短信账户列表最大单页条数 */
export const PULSE_ADMIN_SMS_MAX_PAGE_SIZE = 100;

/** 平台赠送 / 回收门店短信余额：正数为赠送，负数为回收，余额不会低于 0 */
export class GrantPulseAdminSmsBalanceDto {
  @ApiProperty({
    example: 10000,
    description: '金额变动（分）：正数赠送，负数回收',
  })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  )
  @IsInt({ message: 'amountFen 必须是整数' })
  @Min(-PULSE_ADMIN_SMS_MAX_GRANT_FEN, {
    message: `amountFen 不能小于 ${-PULSE_ADMIN_SMS_MAX_GRANT_FEN}`,
  })
  @Max(PULSE_ADMIN_SMS_MAX_GRANT_FEN, {
    message: `amountFen 不能超过 ${PULSE_ADMIN_SMS_MAX_GRANT_FEN}`,
  })
  amountFen: number;

  @ApiPropertyOptional({
    example: '平台运营赠送',
    description: '调整原因，写入钱包流水说明，便于商家端追溯',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'reason 必须是字符串' })
  @MaxLength(100, { message: 'reason 最长 100 位' })
  reason?: string;
}

/**
 * 群发失败退费。
 *
 * 退费是**加钱**操作，只能由平台运营在人工核实后发起（商家端没有入口），
 * 且必须写明原因写入流水，方便后续对账。
 */
export class RefundPulseAdminSmsBroadcastDto {
  @ApiPropertyOptional({
    example: '通道限流导致整批失败，核实后退费',
    description: '退费原因，写入钱包流水说明',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'reason 必须是字符串' })
  @MaxLength(100, { message: 'reason 最长 100 位' })
  reason?: string;
}

/** 门店群发任务列表查询：状态筛选 / 分页 */
export class GetPulseAdminSmsBroadcastsQueryDto {
  @ApiPropertyOptional({
    enum: SMS_BROADCAST_STATUS_VALUES,
    example: 'failed',
    description: '按任务状态筛选；不传为全部。退费只看 failed / partial_failed',
  })
  @IsOptional()
  @IsIn(SMS_BROADCAST_STATUS_VALUES, { message: '任务状态筛选值非法' })
  status?: (typeof SMS_BROADCAST_STATUS_VALUES)[number];

  @ApiPropertyOptional({ example: 1, description: '页码，从 1 开始，默认 1' })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码不能小于 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: '每页条数，默认 20' })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '每页条数必须是整数' })
  @Min(1, { message: '每页条数不能小于 1' })
  @Max(PULSE_ADMIN_SMS_MAX_PAGE_SIZE, {
    message: `每页条数不能超过 ${PULSE_ADMIN_SMS_MAX_PAGE_SIZE}`,
  })
  pageSize?: number;
}

/** 可退费的任务状态（与退费校验同源，避免两处硬编码不一致） */
export const PULSE_ADMIN_SMS_REFUNDABLE_STATUS_VALUES =
  SMS_BROADCAST_REFUNDABLE_STATUS_VALUES;

/** 短信钱包流水 Tab（与前端 SmsBroadcastLogTab 一一对应） */
export const PULSE_ADMIN_SMS_WALLET_LOG_TAB_VALUES = [
  'all',
  'admin',
  'recharge',
  'consume',
  'refund',
] as const;

/** 短信钱包流水 Tab 类型 */
export type PulseAdminSmsWalletLogTab =
  (typeof PULSE_ADMIN_SMS_WALLET_LOG_TAB_VALUES)[number];

/** 短信钱包流水默认单页条数（与前端 SMS_BROADCAST_LOG_PAGE_SIZE 同口径） */
export const PULSE_ADMIN_SMS_WALLET_LOGS_DEFAULT_PAGE_SIZE = 20;

/** 短信钱包流水最大单页条数 */
export const PULSE_ADMIN_SMS_WALLET_LOGS_MAX_PAGE_SIZE = 100;

/** 单门店短信钱包流水查询：Tab 筛选 / 分页 */
export class GetPulseAdminSmsWalletLogsQueryDto {
  @ApiPropertyOptional({
    enum: PULSE_ADMIN_SMS_WALLET_LOG_TAB_VALUES,
    description:
      '流水 Tab：all=全部，admin=平台调整（赠送 + 回收），recharge=充值，' +
      'consume=群发扣费，refund=失败退费；不传按 all 处理',
  })
  @IsOptional()
  @IsIn(PULSE_ADMIN_SMS_WALLET_LOG_TAB_VALUES, {
    message: 'tab 只支持 all / admin / recharge / consume / refund',
  })
  tab?: PulseAdminSmsWalletLogTab;

  @ApiPropertyOptional({
    example: 1,
    description: '页码，从 1 开始，默认 1',
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码不能小于 1' })
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    description: `每页条数，默认 ${PULSE_ADMIN_SMS_WALLET_LOGS_DEFAULT_PAGE_SIZE}，最大 ${PULSE_ADMIN_SMS_WALLET_LOGS_MAX_PAGE_SIZE}`,
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '每页条数必须是整数' })
  @Min(1, { message: '每页条数不能小于 1' })
  @Max(PULSE_ADMIN_SMS_WALLET_LOGS_MAX_PAGE_SIZE, {
    message: `每页条数不能超过 ${PULSE_ADMIN_SMS_WALLET_LOGS_MAX_PAGE_SIZE}`,
  })
  pageSize?: number;
}

/** 门店短信账户列表查询：搜索 / 余额健康度筛选 / 分页 */
export class GetPulseAdminSmsAccountsQueryDto {
  @ApiPropertyOptional({
    example: '刘梅',
    description: '搜索关键词（主账号昵称 / 手机号 / 门店名）',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'keyword 必须是字符串' })
  @MaxLength(50, { message: 'keyword 最长 50 位' })
  keyword?: string;

  @ApiPropertyOptional({
    enum: PULSE_ADMIN_SMS_HEALTH_VALUES,
    description:
      '按短信余额健康度筛选：warning=余额预警（余额>0 且低于预警阈值），' +
      'exhausted=已耗尽（余额=0 且累计已消费>0）；不传为全部门店',
  })
  @IsOptional()
  @IsIn(PULSE_ADMIN_SMS_HEALTH_VALUES, {
    message: 'health 只支持 warning / exhausted',
  })
  health?: PulseAdminSmsHealthFilter;

  @ApiPropertyOptional({
    example: 1,
    description: '页码，从 1 开始，默认 1',
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码不能小于 1' })
  page?: number;

  @ApiPropertyOptional({
    example: 20,
    description: `每页条数，默认 ${PULSE_ADMIN_SMS_DEFAULT_PAGE_SIZE}，最大 ${PULSE_ADMIN_SMS_MAX_PAGE_SIZE}`,
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '每页条数必须是整数' })
  @Min(1, { message: '每页条数不能小于 1' })
  @Max(PULSE_ADMIN_SMS_MAX_PAGE_SIZE, {
    message: `每页条数不能超过 ${PULSE_ADMIN_SMS_MAX_PAGE_SIZE}`,
  })
  pageSize?: number;
}
