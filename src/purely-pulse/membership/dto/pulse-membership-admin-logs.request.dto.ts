import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PULSE_ADMIN_MEMBER_LOG_MAX_LIMIT,
  trimString,
} from './pulse-membership-admin-logs.shared.dto';

export class GetPulseAdminMemberLogsQueryDto {
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
  @Max(PULSE_ADMIN_MEMBER_LOG_MAX_LIMIT, {
    message: `limit 不能超过 ${PULSE_ADMIN_MEMBER_LOG_MAX_LIMIT}`,
  })
  limit?: number;
}
