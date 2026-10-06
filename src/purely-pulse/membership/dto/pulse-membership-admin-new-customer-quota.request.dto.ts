// Pulse / 新客额度管理请求 DTO
// 供 purelyPulse「新客额度」页面使用：门店额度列表 / 增减额度。
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
import { trimString } from './pulse-membership-admin-logs.shared.dto';
import { toNullableNumber } from './pulse-membership-admin-members.shared.dto';

/** 单次可增减的新客额度上限（位新客），防止误传天文数字把余额打爆 */
export const PULSE_ADMIN_NEW_CUSTOMER_QUOTA_MAX_DELTA = 1_000_000;

/** 额度列表健康度筛选值（口径与前端 resolveQuotaHealth 一致） */
export const PULSE_ADMIN_QUOTA_HEALTH_VALUES = [
  'warning',
  'exhausted',
] as const;

/** 额度列表健康度筛选类型 */
export type PulseAdminQuotaHealthFilter =
  (typeof PULSE_ADMIN_QUOTA_HEALTH_VALUES)[number];

/** 额度门店列表默认单页条数 */
export const PULSE_ADMIN_QUOTA_STORES_DEFAULT_PAGE_SIZE = 20;

/** 额度门店列表最大单页条数 */
export const PULSE_ADMIN_QUOTA_STORES_MAX_PAGE_SIZE = 100;

/** 增减门店新客额度：正数为发放，负数为回收，余额不会低于 0 */
export class AdjustPulseAdminNewCustomerQuotaDto {
  @ApiProperty({
    example: 100,
    description: '额度增量（位新客）：正数发放，负数回收',
  })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  )
  @IsInt({ message: 'delta 必须是整数' })
  @Min(-PULSE_ADMIN_NEW_CUSTOMER_QUOTA_MAX_DELTA, {
    message: `delta 不能小于 ${-PULSE_ADMIN_NEW_CUSTOMER_QUOTA_MAX_DELTA}`,
  })
  @Max(PULSE_ADMIN_NEW_CUSTOMER_QUOTA_MAX_DELTA, {
    message: `delta 不能超过 ${PULSE_ADMIN_NEW_CUSTOMER_QUOTA_MAX_DELTA}`,
  })
  delta: number;

  @ApiPropertyOptional({
    example: '平台运营发放',
    description: '增减原因，写入额度流水说明，便于商家端追溯',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'reason 必须是字符串' })
  @MaxLength(100, { message: 'reason 最长 100 位' })
  reason?: string;
}

/** 门店新客额度列表查询：搜索 / 健康度筛选 / 分页 */
export class GetPulseAdminNewCustomerQuotaStoresQueryDto {
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
    enum: PULSE_ADMIN_QUOTA_HEALTH_VALUES,
    description:
      '按额度健康度筛选：warning=额度预警（剩余>0 且低于预警阈值），' +
      'exhausted=已耗尽（剩余=0 且累计已服务>0）；不传为全部门店',
  })
  @IsOptional()
  @IsIn(PULSE_ADMIN_QUOTA_HEALTH_VALUES, {
    message: 'health 只支持 warning / exhausted',
  })
  health?: PulseAdminQuotaHealthFilter;

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
    description: `每页条数，默认 ${PULSE_ADMIN_QUOTA_STORES_DEFAULT_PAGE_SIZE}，最大 ${PULSE_ADMIN_QUOTA_STORES_MAX_PAGE_SIZE}`,
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '每页条数必须是整数' })
  @Min(1, { message: '每页条数不能小于 1' })
  @Max(PULSE_ADMIN_QUOTA_STORES_MAX_PAGE_SIZE, {
    message: `每页条数不能超过 ${PULSE_ADMIN_QUOTA_STORES_MAX_PAGE_SIZE}`,
  })
  pageSize?: number;
}
