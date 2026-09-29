import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PULSE_ADMIN_MEMBER_LOG_MAX_LIMIT,
  trimString,
} from './pulse-membership-admin-logs.shared.dto';
import {
  PULSE_ADMIN_MEMBER_RECORD_DATE_PATTERN,
  PULSE_ADMIN_MEMBER_RECORD_LEVEL_VALUES,
  PULSE_ADMIN_MEMBER_RECORD_TYPE_VALUES,
} from './pulse-membership-admin-member-records.shared.dto';
import type {
  PulseAdminMemberRecordLevelValue,
  PulseAdminMemberRecordTypeValue,
} from './pulse-membership-admin-member-records.shared.dto';

/**
 * 会员记录管理查询参数。
 *
 * 日期两组互斥：`date` 是「单独日期」，`startDate` + `endDate` 是区间；
 * 前端保证同时只下发一组，后端以 `date` 优先，避免两组同时生效时「到底查哪天」产生歧义。
 */
export class GetPulseAdminMemberRecordsQueryDto {
  @ApiPropertyOptional({
    example: '13619654040',
    description: '会员手机号，模糊匹配（门店联系电话 / 微信手机号 / 登录邮箱）',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'phone 必须是字符串' })
  @MaxLength(64, { message: 'phone 最长 64 位' })
  phone?: string;

  @ApiPropertyOptional({
    example: '张小明',
    description: '会员姓名，模糊匹配（门店名 / 账号名 / 实名）',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'name 必须是字符串' })
  @MaxLength(64, { message: 'name 最长 64 位' })
  name?: string;

  @ApiPropertyOptional({
    example: '2026-09-29',
    description:
      '单独日期：只查这一天的记录；与 startDate / endDate 互斥，同时传时以本字段为准',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'date 必须是字符串' })
  @Matches(PULSE_ADMIN_MEMBER_RECORD_DATE_PATTERN, {
    message: 'date 必须是 YYYY-MM-DD 格式',
  })
  date?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: '开始日期（含当天，上海时区）；只填一端时按单日处理',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'startDate 必须是字符串' })
  @Matches(PULSE_ADMIN_MEMBER_RECORD_DATE_PATTERN, {
    message: 'startDate 必须是 YYYY-MM-DD 格式',
  })
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description:
      '结束日期（含当天，上海时区）；早于开始日期时自动与开始日期互换',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'endDate 必须是字符串' })
  @Matches(PULSE_ADMIN_MEMBER_RECORD_DATE_PATTERN, {
    message: 'endDate 必须是 YYYY-MM-DD 格式',
  })
  endDate?: string;

  @ApiPropertyOptional({
    enum: ['all', ...PULSE_ADMIN_MEMBER_RECORD_LEVEL_VALUES],
    example: 'all',
    description: '会员等级（按会员当前等级筛选）；默认 all',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(['all', ...PULSE_ADMIN_MEMBER_RECORD_LEVEL_VALUES], {
    message: 'level 取值不合法',
  })
  level?: 'all' | PulseAdminMemberRecordLevelValue;

  @ApiPropertyOptional({
    enum: ['all', ...PULSE_ADMIN_MEMBER_RECORD_TYPE_VALUES],
    example: 'all',
    description:
      '记录类型：充值 / 会员等级设置 / 调整续费 / 子账号设置；默认 all',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsIn(['all', ...PULSE_ADMIN_MEMBER_RECORD_TYPE_VALUES], {
    message: 'type 取值不合法',
  })
  type?: 'all' | PulseAdminMemberRecordTypeValue;

  @ApiPropertyOptional({
    example: '1759084800000_adminGrant_128',
    description: '游标分页标记；不传则从最新一条开始',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'cursor 必须是字符串' })
  @MaxLength(128, { message: 'cursor 最长 128 位' })
  cursor?: string;

  @ApiPropertyOptional({
    example: 20,
    description: '每页条数，默认 20，最大 100',
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
