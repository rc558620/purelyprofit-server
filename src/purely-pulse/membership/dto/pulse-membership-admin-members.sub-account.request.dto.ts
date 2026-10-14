// Pulse / 管理端子账号请求 DTO
//
// 子账号的两类写操作：整店额度调整（quota / subAccountQuota 兼容双字段）与
// 单槽位配置（角色 / 状态 / 分配员工 / 权限开关）。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PulseAdminMemberIdentityFieldsDto } from './pulse-membership-admin-members.base.dto';
import {
  PULSE_SUB_ACCOUNT_ROLE_VALUES,
  PULSE_SUB_ACCOUNT_STATUS_VALUES,
} from './pulse-membership-admin-members.constants';
import { toOptionalInt } from './pulse-membership-admin-members.transform';
import type {
  PulseSubAccountRoleValue,
  PulseSubAccountStatusValue,
} from '../membership.types';

/** 子账号槽位角色摘要（兼容 purelyPulse 前端的提交结构） */
export class PulseAdminMemberSubAccountQuotaRoleSummaryDto {
  @ApiProperty({ example: 1, description: '子账号槽位序号，范围 1~10' })
  @Type(() => Number)
  @IsInt({ message: '槽位序号必须是整数' })
  @Min(1, { message: '槽位序号不能小于 1' })
  @Max(10, { message: '槽位序号不能超过 10' })
  slot: number;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色，仅支持 cashier / finance / manager',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES, { message: '子账号角色不合法' })
  role: PulseSubAccountRoleValue;

  @ApiPropertyOptional({
    enum: PULSE_SUB_ACCOUNT_STATUS_VALUES,
    description: '子账号状态，默认 active',
  })
  @IsOptional()
  @IsIn(PULSE_SUB_ACCOUNT_STATUS_VALUES, { message: '子账号状态不合法' })
  status?: PulseSubAccountStatusValue;

  @ApiPropertyOptional({ example: false, description: '是否已分配员工' })
  @IsOptional()
  @IsBoolean({ message: '是否已分配员工必须是布尔值' })
  isAssigned?: boolean;
}

/** 调整子账号额度 */
export class PulseAdminMemberSubAccountQuotaDto extends PulseAdminMemberIdentityFieldsDto {
  @ApiProperty({ example: 2, description: '目标子账号额度，范围 0~10' })
  @ValidateIf(
    (dto: PulseAdminMemberSubAccountQuotaDto) =>
      dto.subAccountQuota === undefined,
  )
  @Transform(({ value, obj }) => {
    const raw = value ?? obj?.subAccountQuota;
    return toOptionalInt(raw);
  })
  @IsInt({ message: '子账号额度必须是整数' })
  @Min(0, { message: '子账号额度不能小于 0' })
  @Max(10, { message: '子账号额度不能超过 10' })
  quota!: number;

  @ApiPropertyOptional({
    example: 2,
    description: '兼容旧请求的子账号额度字段，范围 0~10',
  })
  @IsOptional()
  @ValidateIf(
    (dto: PulseAdminMemberSubAccountQuotaDto) => dto.quota === undefined,
  )
  @Transform(({ value }) => toOptionalInt(value))
  @IsInt({ message: '子账号额度必须是整数' })
  @Min(0, { message: '子账号额度不能小于 0' })
  @Max(10, { message: '子账号额度不能超过 10' })
  subAccountQuota?: number;

  @ApiPropertyOptional({ example: '年会员权益升级', description: '调整原因' })
  @IsOptional()
  @IsString({ message: '调整原因必须是字符串' })
  @MaxLength(100, { message: '调整原因最多 100 位' })
  reason?: string;

  @ApiPropertyOptional({
    type: [PulseAdminMemberSubAccountQuotaRoleSummaryDto],
    description: '兼容 purelyPulse 前端的槽位角色摘要提交',
  })
  @IsOptional()
  @IsArray({ message: '槽位角色摘要必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberSubAccountQuotaRoleSummaryDto)
  roleSummary?: PulseAdminMemberSubAccountQuotaRoleSummaryDto[];
}

/** 子账号槽位配置（角色 / 状态 / 分配员工 / 权限开关） */
export class PulseAdminMemberSubAccountSlotDto {
  @ApiProperty({ example: 1, description: '子账号槽位序号，范围 1~10' })
  @Type(() => Number)
  @IsInt({ message: '槽位序号必须是整数' })
  @Min(1, { message: '槽位序号不能小于 1' })
  @Max(10, { message: '槽位序号不能超过 10' })
  slotIndex: number;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色，仅支持 cashier / finance / manager',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES, { message: '子账号角色不合法' })
  role: PulseSubAccountRoleValue;

  @ApiPropertyOptional({
    enum: PULSE_SUB_ACCOUNT_STATUS_VALUES,
    description: '子账号状态，默认 active',
  })
  @IsOptional()
  @IsIn(PULSE_SUB_ACCOUNT_STATUS_VALUES, { message: '子账号状态不合法' })
  status?: PulseSubAccountStatusValue;

  @ApiPropertyOptional({
    example: 18,
    description: '分配的员工 ID，不传或 null 表示清空分配',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return Number(value);
  })
  @IsInt({ message: '员工 ID 必须是整数' })
  employeeId?: number | null;

  @ApiPropertyOptional({
    example: true,
    description: '是否允许首页访问，默认跟随状态',
  })
  @IsOptional()
  @IsBoolean({ message: '首页访问开关必须是布尔值' })
  canAccessHome?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: '是否允许交班，默认跟随状态',
  })
  @IsOptional()
  @IsBoolean({ message: '交班开关必须是布尔值' })
  canUseHandover?: boolean;
}
