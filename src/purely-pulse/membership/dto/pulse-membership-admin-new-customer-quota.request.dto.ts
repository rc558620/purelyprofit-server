// Pulse / 新客额度管理请求 DTO
// 供 purelyPulse「新客额度」页面使用：门店额度列表 / 增减额度。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimString } from './pulse-membership-admin-logs.shared.dto';

/** 单次可增减的新客额度上限（位新客），防止误传天文数字把余额打爆 */
export const PULSE_ADMIN_NEW_CUSTOMER_QUOTA_MAX_DELTA = 1_000_000;

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
