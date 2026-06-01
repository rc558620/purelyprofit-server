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
  PULSE_MEMBER_LEVEL_VALUES,
  PULSE_MEMBER_STATUS_VALUES,
  PulseRechargeRecordDto,
  PulseSubAccountCapabilityDto,
  PulseSubAccountRoleSummaryDto,
  PulseSubAccountSlotDto,
} from './pulse-membership-admin-members.shared.dto';
import type {
  PulseMemberLevelValue,
  PulseMemberStatusValue,
} from './pulse-membership-admin-members.shared.dto';

export class PulseMemberListItemDto {
  @ApiProperty({ example: 'm001', description: '会员 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '刘梅', description: '会员姓名' })
  @IsString()
  name: string;

  @ApiProperty({ example: '138****9021', description: '会员手机号（脱敏）' })
  @IsString()
  phone: string;

  @ApiProperty({
    example: '刘',
    description: '头像文字（姓名首字，对齐前端 MemberListItem.avatarChar）',
  })
  @IsString()
  avatarChar: string;

  @ApiProperty({
    example: 0,
    description: '头像颜色索引 0-5（对齐前端 MemberListItem.avatarColorIdx）',
  })
  @IsInt()
  avatarColorIdx: number;

  @ApiProperty({
    enum: PULSE_MEMBER_STATUS_VALUES,
    example: 'active',
    description: '会员状态：active=正常 / inactive=未活跃 / banned=已封禁',
  })
  @IsIn(PULSE_MEMBER_STATUS_VALUES)
  status: PulseMemberStatusValue;

  @ApiProperty({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    example: 'annual',
    description:
      '会员等级：free=免费 / monthly=月卡 / quarterly=季卡 / annual=年卡 / lifetime=永久',
  })
  @IsIn(PULSE_MEMBER_LEVEL_VALUES)
  level: PulseMemberLevelValue;

  @ApiProperty({ example: 1280, description: '当前积分余额' })
  @IsInt()
  availablePoints: number;

  @ApiProperty({ example: 0, description: '纯利豆余额' })
  @IsInt()
  beanBalance: number;

  @ApiProperty({ example: false, description: '是否是合伙人' })
  @IsBoolean()
  isPartner: boolean;

  @ApiProperty({ example: 59800, description: '累计充值金额（分）' })
  @IsInt()
  totalRecharged: number;

  @ApiProperty({ example: 1747123200000, description: '注册时间戳（ms）' })
  @IsInt()
  registeredAt: number;

  @ApiProperty({ example: 1747209600000, description: '最近活跃时间戳（ms）' })
  @IsInt()
  lastActiveAt: number;

  @ApiProperty({ example: true, description: '是否具备配置子账号资格' })
  @IsBoolean()
  subAccountEligible: boolean;

  @ApiProperty({ example: 2, description: '当前子账号额度' })
  @IsInt()
  subAccountQuota: number;

  @ApiProperty({ example: true, description: '是否已启用子账号能力' })
  @IsBoolean()
  subAccountCapabilityEnabled: boolean;
}

/**
 * 管理员视角的会员详情
 * 对齐前端 MemberDetail（memberList.types.ts）
 */
export class PulseMemberDetailDto {
  @ApiProperty({ example: 'm001', description: '会员 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '刘梅', description: '会员姓名' })
  @IsString()
  name: string;

  @ApiProperty({ example: '138****9021', description: '会员手机号（脱敏）' })
  @IsString()
  phone: string;

  @ApiProperty({
    example: '刘',
    description: '头像文字（姓名首字，对齐前端 MemberDetail.avatarChar）',
  })
  @IsString()
  avatarChar: string;

  @ApiProperty({
    example: 0,
    description: '头像颜色索引 0-5（对齐前端 MemberDetail.avatarColorIdx）',
  })
  @IsInt()
  avatarColorIdx: number;

  @ApiProperty({
    enum: PULSE_MEMBER_STATUS_VALUES,
    example: 'active',
    description: '会员状态',
  })
  @IsIn(PULSE_MEMBER_STATUS_VALUES)
  status: PulseMemberStatusValue;

  @ApiProperty({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    example: 'annual',
    description: '会员等级',
  })
  @IsIn(PULSE_MEMBER_LEVEL_VALUES)
  level: PulseMemberLevelValue;

  @ApiProperty({ example: 1747123200000, description: '注册时间戳（ms）' })
  @IsInt()
  registeredAt: number;

  @ApiProperty({ example: 1747209600000, description: '最近活跃时间戳（ms）' })
  @IsInt()
  lastActiveAt: number;

  @ApiProperty({ example: 1280, description: '当前积分余额' })
  @IsInt()
  availablePoints: number;

  @ApiProperty({
    example: 2800,
    description: '历史累计积分（对齐前端 MemberDetail.totalPointsEarned）',
  })
  @IsInt()
  totalPointsEarned: number;

  @ApiProperty({ example: 0, description: '纯利豆余额' })
  @IsInt()
  beanBalance: number;

  @ApiProperty({ example: false, description: '是否是合伙人' })
  @IsBoolean()
  isPartner: boolean;

  @ApiPropertyOptional({
    example: 'P2',
    description: '合伙人等级，非合伙人时为空',
  })
  @IsOptional()
  @IsString()
  partnerLevel?: string;

  @ApiProperty({ example: 59800, description: '累计充值金额（分）' })
  @IsInt()
  totalRecharged: number;

  @ApiProperty({
    example: 3,
    description: '充值次数（对齐前端 MemberDetail.rechargeCount）',
  })
  @IsInt()
  rechargeCount: number;

  @ApiProperty({
    example: 2,
    description: '推广带来的新用户数（对齐前端 MemberDetail.invitedCount）',
  })
  @IsInt()
  invitedCount: number;

  @ApiProperty({
    type: [PulseRechargeRecordDto],
    description: '充值记录列表（对齐前端 MemberDetail.rechargeHistory）',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseRechargeRecordDto)
  rechargeHistory: PulseRechargeRecordDto[];

  @ApiPropertyOptional({
    example: '老会员，优先服务',
    description: '备注（对齐前端 MemberDetail.remark）',
  })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiPropertyOptional({
    example: 1747209600000,
    description:
      '会员到期时间戳（ms），永久会员为 null（对齐前端 MemberDetail.membershipExpiry）',
  })
  @IsOptional()
  @IsInt()
  membershipExpiry?: number | null;

  @ApiProperty({ example: true, description: '是否具备配置子账号资格' })
  @IsBoolean()
  subAccountEligible: boolean;

  @ApiProperty({ example: 2, description: '当前子账号额度' })
  @IsInt()
  subAccountQuota: number;

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
    type: [PulseSubAccountRoleSummaryDto],
    description: '当前门店子账号角色分布摘要',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseSubAccountRoleSummaryDto)
  subAccountRoleSummary: PulseSubAccountRoleSummaryDto[];

  @ApiProperty({
    type: [PulseSubAccountSlotDto],
    description: '当前门店子账号槽位列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseSubAccountSlotDto)
  subAccountSlots: PulseSubAccountSlotDto[];

  @ApiProperty({
    type: PulseSubAccountCapabilityDto,
    description:
      '对齐 purelyPulse 前端 MemberDetail.subAccountCapability 的嵌套结构',
  })
  @ValidateNested()
  @Type(() => PulseSubAccountCapabilityDto)
  subAccountCapability: PulseSubAccountCapabilityDto;
}

/**
 * 管理员会员列表响应
 */
export class PulseAdminMembersResponseDto {
  @ApiProperty({
    type: [PulseMemberListItemDto],
    description: '会员列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseMemberListItemDto)
  items: PulseMemberListItemDto[];

  @ApiProperty({ example: 158, description: '会员总数' })
  @IsInt()
  total: number;
}

/**
 * Pulse 管理端：门店在职员工候选列表项
 * 用于子账号槽位分配时的员工选择下拉
 */
export class PulseAdminEmployeeCandidateDto {
  @ApiProperty({ example: '18', description: '员工 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '张三', description: '员工姓名' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '店长', description: '职位名称' })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({ example: '前厅', description: '部门名称' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiProperty({ example: true, description: '是否已分配子账号槽位' })
  @IsBoolean()
  hasSubAccount: boolean;

  @ApiPropertyOptional({
    example: 2,
    description: '已分配的槽位序号（若无则为空）',
  })
  @IsOptional()
  @IsInt()
  assignedSlotIndex?: number;
}

/**
 * Pulse 管理端：门店在职员工候选列表响应
 */
export class PulseAdminEmployeeCandidatesResponseDto {
  @ApiProperty({
    type: [PulseAdminEmployeeCandidateDto],
    description: '在职员工候选列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminEmployeeCandidateDto)
  items: PulseAdminEmployeeCandidateDto[];
}
