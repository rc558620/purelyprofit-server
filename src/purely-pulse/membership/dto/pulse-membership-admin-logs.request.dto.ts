import { ApiPropertyOptional } from '@nestjs/swagger';
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
  PULSE_ADMIN_MEMBER_BEAN_TAB_VALUES,
  PULSE_ADMIN_MEMBER_LOG_MAX_KEYWORD_LENGTH,
  PULSE_ADMIN_MEMBER_LOG_MAX_LIMIT,
  PULSE_ADMIN_MEMBER_POINTS_TAB_VALUES,
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

  @ApiPropertyOptional({
    enum: PULSE_ADMIN_MEMBER_POINTS_TAB_VALUES,
    example: 'all',
    description:
      '积分流水 Tab 筛选（仅 points/logs 生效）：all=全部，admin=管理员调整，' +
      'earn=获得（业务性获得，不含管理员调整），spend=消耗（抵扣 / 过期，不含管理员调整）',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(PULSE_ADMIN_MEMBER_POINTS_TAB_VALUES, {
    message: 'pointsTab 只能是 all / admin / earn / spend',
  })
  pointsTab?: (typeof PULSE_ADMIN_MEMBER_POINTS_TAB_VALUES)[number];

  @ApiPropertyOptional({
    enum: PULSE_ADMIN_MEMBER_BEAN_TAB_VALUES,
    example: 'all',
    description:
      '纯利豆流水 Tab 筛选（仅 beans/logs 生效）：all=全部，admin=管理员调整，' +
      'earn=获得（业务性获得，不含管理员调整），spend=消耗/提现（不含管理员调整）',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(PULSE_ADMIN_MEMBER_BEAN_TAB_VALUES, {
    message: 'beanTab 只能是 all / admin / earn / spend',
  })
  beanTab?: (typeof PULSE_ADMIN_MEMBER_BEAN_TAB_VALUES)[number];

  @ApiPropertyOptional({
    example: '张三',
    description:
      '关键词：模糊匹配流水说明、门店名、门店联系电话、会员姓名与手机号；' +
      'points/logs 与 beans/logs 共用同一组匹配字段',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'keyword 必须是字符串' })
  @MaxLength(PULSE_ADMIN_MEMBER_LOG_MAX_KEYWORD_LENGTH, {
    message: `keyword 最长 ${PULSE_ADMIN_MEMBER_LOG_MAX_KEYWORD_LENGTH} 位`,
  })
  keyword?: string;
}
