import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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

  @ApiProperty({ example: '13800138000', description: '会员手机号' })
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

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar/user.png',
    description:
      '用户头像 URL，未设置时为空串（对齐前端 MemberListItem.avatarUrl）',
  })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

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

  @ApiProperty({
    example: '598',
    description: '累计充值金额展示值（元，字符串），后端直接计算，前端仅展示',
  })
  @IsString()
  totalRechargedDisplay: string;

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

  @ApiPropertyOptional({
    example: 1747209600000,
    description:
      '会员到期时间戳（ms），永久会员为 null（对齐前端 MemberListItem.membershipExpiry）',
  })
  @IsOptional()
  @IsInt()
  membershipExpiry?: number | null;
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

  @ApiProperty({ example: '13800138000', description: '会员手机号' })
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

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar/user.png',
    description:
      '用户头像 URL，未设置时为空串（对齐前端 MemberDetail.avatarUrl）',
  })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

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
    example: '598',
    description: '累计充值金额展示值（元，字符串），后端直接计算，前端仅展示',
  })
  @IsString()
  totalRechargedDisplay: string;

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

/**
 * purelyClub C 端会员等级分布
 * 枚举固定为 free / gold / platinum / diamond
 */
export class PulseAdminMemberClubLevelBreakdownDto {
  @ApiProperty({ example: 18, description: '免费会员数量' })
  @IsInt()
  free: number;

  @ApiProperty({ example: 8, description: '黄金会员数量' })
  @IsInt()
  gold: number;

  @ApiProperty({ example: 4, description: '铂金会员数量' })
  @IsInt()
  platinum: number;

  @ApiProperty({ example: 2, description: '钻石会员数量' })
  @IsInt()
  diamond: number;
}

/**
 * purelyClub C 端会员运营统计（owner 视角）
 * 对齐前端 ClubMemberStats（memberList.types.ts）
 */
export class PulseAdminMemberClubStatsDto {
  @ApiProperty({ example: 1288058, description: '顾客在途余额合计（分）' })
  @IsInt()
  pendingBalanceFen: number;

  @ApiProperty({ example: 2267000, description: '会员充值总金额（分）' })
  @IsInt()
  totalRechargeFen: number;

  @ApiProperty({ example: 32, description: '会员用户总数' })
  @IsInt()
  totalMemberCount: number;

  @ApiProperty({ example: 147, description: '累计充值笔数' })
  @IsInt()
  rechargeCount: number;

  @ApiProperty({ example: 38800, description: '今日储值金额（分）' })
  @IsInt()
  todayRechargeFen: number;

  @ApiProperty({ example: 326500, description: '本月储值金额（分）' })
  @IsInt()
  monthRechargeFen: number;

  @ApiProperty({ example: 892000, description: '本季储值金额（分）' })
  @IsInt()
  quarterRechargeFen: number;

  @ApiProperty({ example: 1842000, description: '本年储值金额（分）' })
  @IsInt()
  yearRechargeFen: number;

  @ApiProperty({ example: 1250000, description: '去年储值金额（分）' })
  @IsInt()
  lastYearRechargeFen: number;

  @ApiProperty({
    type: PulseAdminMemberClubLevelBreakdownDto,
    description: '各等级会员数量分布',
  })
  @ValidateNested()
  @Type(() => PulseAdminMemberClubLevelBreakdownDto)
  levelBreakdown: PulseAdminMemberClubLevelBreakdownDto;
}

// ─── 营业详情统计 DTO ─────────────────────────────────────────────────────────

/** 单周期销售/利润数据点（ECharts 柱状图）。 */
export class PulseAdminMemberSalesDataPointDto {
  @ApiProperty({ example: '周一', description: '时间标签' })
  @IsString()
  label: string;

  @ApiProperty({ example: 12800, description: '销售额（分）' })
  @IsInt()
  salesFen: number;

  @ApiProperty({ example: 3200, description: '利润（分）' })
  @IsInt()
  profitFen: number;

  @ApiProperty({
    example: '128',
    description: '销售额展示值（元，后端格式化）',
  })
  @IsString()
  salesDisplay: string;

  @ApiProperty({
    example: '32',
    description: '利润展示值（元，后端格式化）',
  })
  @IsString()
  profitDisplay: string;
}

/** 单维度销售汇总。 */
export class PulseAdminMemberSalesPeriodSummaryDto {
  @ApiProperty({ example: 'today', description: '时间维度' })
  @IsString()
  period: string;

  @ApiProperty({ example: 128800, description: '销售总额（分）' })
  @IsInt()
  totalSalesFen: number;

  @ApiProperty({ example: 32200, description: '利润总额（分）' })
  @IsInt()
  totalProfitFen: number;

  @ApiProperty({
    example: '1288',
    description: '销售总额展示值（元，后端格式化）',
  })
  @IsString()
  totalSalesDisplay: string;

  @ApiProperty({
    example: '322',
    description: '利润总额展示值（元，后端格式化）',
  })
  @IsString()
  totalProfitDisplay: string;

  @ApiPropertyOptional({
    example: 12.5,
    description: '销售额环比增幅（百分比）',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  salesGrowthPct: number | null;

  @ApiPropertyOptional({
    example: 8.3,
    description: '利润环比增幅（百分比）',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  profitGrowthPct: number | null;

  @ApiProperty({
    type: [PulseAdminMemberSalesDataPointDto],
    description: '各时间点明细',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberSalesDataPointDto)
  dataPoints: PulseAdminMemberSalesDataPointDto[];
}

/** 商家营业详情统计（owner 视角，含 5 个周期）。 */
export class PulseAdminMemberSalesStatsDto {
  @ApiProperty({ type: PulseAdminMemberSalesPeriodSummaryDto })
  @ValidateNested()
  @Type(() => PulseAdminMemberSalesPeriodSummaryDto)
  today: PulseAdminMemberSalesPeriodSummaryDto;

  @ApiProperty({ type: PulseAdminMemberSalesPeriodSummaryDto })
  @ValidateNested()
  @Type(() => PulseAdminMemberSalesPeriodSummaryDto)
  week: PulseAdminMemberSalesPeriodSummaryDto;

  @ApiProperty({ type: PulseAdminMemberSalesPeriodSummaryDto })
  @ValidateNested()
  @Type(() => PulseAdminMemberSalesPeriodSummaryDto)
  month: PulseAdminMemberSalesPeriodSummaryDto;

  @ApiProperty({ type: PulseAdminMemberSalesPeriodSummaryDto })
  @ValidateNested()
  @Type(() => PulseAdminMemberSalesPeriodSummaryDto)
  year: PulseAdminMemberSalesPeriodSummaryDto;

  @ApiProperty({ type: PulseAdminMemberSalesPeriodSummaryDto })
  @ValidateNested()
  @Type(() => PulseAdminMemberSalesPeriodSummaryDto)
  lastYear: PulseAdminMemberSalesPeriodSummaryDto;
}
