// Pulse / 管理端会员列表查询 DTO
//
// GET /pulse/membership/admin/members 的查询参数：筛选条件 + 分页。
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  PULSE_ADMIN_MEMBER_LIST_MAX_PAGE_SIZE,
  PULSE_MEMBER_FILTER_EXPIRY_VALUES,
  PULSE_MEMBER_FILTER_LEVEL_VALUES,
  PULSE_MEMBER_FILTER_STATUS_VALUES,
} from './pulse-membership-admin-members.constants';
import {
  toNullableNumber,
  toOptionalBoolean,
} from './pulse-membership-admin-members.transform';
import type {
  PulseMemberFilterExpiryValue,
  PulseMemberFilterLevelValue,
  PulseMemberFilterStatusValue,
} from './pulse-membership-admin-members.constants';

/**
 * GET /pulse/membership/admin/members
 * 管理员获取会员列表 — 查询参数
 */
export class GetPulseAdminMembersQueryDto {
  @ApiPropertyOptional({
    example: true,
    description:
      '只看「有子账号能力但成交价快照里缺子账号加价」的门店，供运营批量补录。' +
      '这些门店的续费价只按当前配置价收，等于白送子账号权益',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean({ message: '待补录筛选必须是布尔值' })
  pendingSubAccountBackfill?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      '只看「续费价被调整过」的门店，供运营复核议过价的客户。' +
      '口径是曾经调过：后来在弹窗里清空覆盖（恢复配置价）的门店仍然算，不会掉出清单',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean({ message: '续费价调整筛选必须是布尔值' })
  renewalPriceAdjusted?: boolean;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_STATUS_VALUES,
    description: '会员状态筛选，不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_STATUS_VALUES, { message: '会员状态筛选不合法' })
  status?: PulseMemberFilterStatusValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_LEVEL_VALUES,
    description: '会员等级筛选，不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_LEVEL_VALUES, { message: '会员等级筛选不合法' })
  level?: PulseMemberFilterLevelValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_EXPIRY_VALUES,
    description: '会员到期时间筛选（相对当前时间），不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_EXPIRY_VALUES, {
    message: '会员到期时间筛选不合法',
  })
  expiry?: PulseMemberFilterExpiryValue;

  @ApiPropertyOptional({
    example: true,
    description: '是否仅返回合伙人，兼容 partner=true 查询',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean({ message: '合伙人筛选标记必须是布尔值' })
  partner?: boolean;

  @ApiPropertyOptional({
    example: '刘梅',
    description: '搜索关键词（姓名 / 手机号）',
  })
  @IsOptional()
  @IsString({ message: '搜索关键词必须是字符串' })
  keyword?: string;

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
    description: '每页条数，默认 20，最大 100',
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '每页条数必须是整数' })
  @Min(1, { message: '每页条数不能小于 1' })
  @Max(PULSE_ADMIN_MEMBER_LIST_MAX_PAGE_SIZE, {
    message: `每页条数不能超过 ${PULSE_ADMIN_MEMBER_LIST_MAX_PAGE_SIZE}`,
  })
  pageSize?: number;
}
