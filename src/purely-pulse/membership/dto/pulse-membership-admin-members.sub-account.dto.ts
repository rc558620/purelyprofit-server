// Pulse / 管理端会员子账号相关 DTO
//
// 子账号的展示结构：角色汇总、槽位明细、以及前端配置弹窗用的能力摘要。

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  PULSE_SUB_ACCOUNT_ROLE_VALUES,
  PULSE_SUB_ACCOUNT_STATUS_VALUES,
} from './pulse-membership-admin-members.constants';
import type {
  PulseSubAccountRoleValue,
  PulseSubAccountStatusValue,
} from '../membership.types';

export class PulseSubAccountRoleSummaryDto {
  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES)
  role: PulseSubAccountRoleValue;

  @ApiProperty({ example: 2, description: '激活槽位数量' })
  @IsInt()
  activeCount: number;

  @ApiProperty({ example: 1, description: '停用槽位数量' })
  @IsInt()
  inactiveCount: number;

  @ApiProperty({ example: 0, description: '禁用槽位数量' })
  @IsInt()
  disabledCount: number;

  @ApiProperty({ example: 2, description: '已分配数量' })
  @IsInt()
  assignedCount: number;
}

export class PulseSubAccountSlotDto {
  @ApiProperty({ example: '12', description: '子账号槽位 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: 1, description: '槽位序号，范围 1~10' })
  @IsInt()
  slotIndex: number;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES)
  role: PulseSubAccountRoleValue;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_STATUS_VALUES,
    description: '子账号状态',
  })
  @IsIn(PULSE_SUB_ACCOUNT_STATUS_VALUES)
  status: PulseSubAccountStatusValue;

  @ApiProperty({ example: false, description: '是否已分配员工' })
  @IsBoolean()
  isAssigned: boolean;

  @ApiPropertyOptional({ example: '18', description: '已分配员工 ID' })
  @IsOptional()
  @IsString()
  employeeId?: string | null;

  @ApiPropertyOptional({ example: '小李', description: '已分配员工姓名' })
  @IsOptional()
  @IsString()
  employeeName?: string | null;

  @ApiProperty({ example: true, description: '是否允许首页访问' })
  @IsBoolean()
  canAccessHome: boolean;

  @ApiProperty({ example: true, description: '是否允许交班' })
  @IsBoolean()
  canUseHandover: boolean;
}

export class PulseSubAccountCapabilityRoleSummaryItemDto {
  @ApiProperty({ example: 1, description: '子账号槽位序号，范围 1~10' })
  @IsInt()
  slot: number;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES)
  role: PulseSubAccountRoleValue;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_STATUS_VALUES,
    description: '子账号状态',
  })
  @IsIn(PULSE_SUB_ACCOUNT_STATUS_VALUES)
  status: PulseSubAccountStatusValue;

  @ApiProperty({ example: false, description: '是否已分配员工' })
  @IsBoolean()
  isAssigned: boolean;
}

export class PulseSubAccountCapabilityDto {
  @ApiProperty({ example: 2, description: '当前子账号额度' })
  @IsInt()
  subAccountQuota: number;

  @ApiProperty({ example: true, description: '是否具备配置子账号资格' })
  @IsBoolean()
  subAccountEligible: boolean;

  @ApiProperty({ example: true, description: '是否已启用子账号能力' })
  @IsBoolean()
  subAccountCapabilityEnabled: boolean;

  @ApiProperty({ example: 10, description: '当前会员允许配置的子账号上限' })
  @IsInt()
  subAccountQuotaMax: number;

  @ApiProperty({ example: 2, description: '已使用子账号数量' })
  @IsInt()
  subAccountsUsedCount: number;

  @ApiProperty({ example: 8, description: '剩余可分配子账号数量' })
  @IsInt()
  subAccountsAvailableCount: number;

  @ApiProperty({
    type: [PulseSubAccountCapabilityRoleSummaryItemDto],
    description: '前端子账号配置弹窗使用的槽位摘要列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseSubAccountCapabilityRoleSummaryItemDto)
  subAccountRoleSummary: PulseSubAccountCapabilityRoleSummaryItemDto[];
}
