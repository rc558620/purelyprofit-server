import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PLATFORM_MEMBERSHIP_PLAN_IDS } from './platform-membership-query.dto';

/**
 * 会员能力矩阵（后端权威下发）。
 *
 * 字段与前端 `MemberPlanCapabilities` 一一对应，前端不再维护本地常量作为真相，
 * 仅在后端未下发时回退到本地兜底值。
 */
export class PlatformMembershipCapabilitiesDto {
  @ApiProperty({
    example: 'free',
    description: '当前生效的会员档位；free 表示未开通或已过期',
  })
  @IsString({ message: '会员档位必须是字符串' })
  level: string;

  @ApiPropertyOptional({
    example: 3,
    description: '商品数上限，null 表示不限制',
  })
  @IsOptional()
  @IsInt({ message: '商品数上限必须是整数' })
  productLimit: number | null;

  @ApiPropertyOptional({
    example: 1,
    description: '商品分类上限，null 表示不限制',
  })
  @IsOptional()
  @IsInt({ message: '商品分类上限必须是整数' })
  categoryLimit: number | null;

  @ApiPropertyOptional({
    example: 5,
    description: '员工数上限，null 表示不限制',
  })
  @IsOptional()
  @IsInt({ message: '员工数上限必须是整数' })
  employeeLimit: number | null;

  @ApiPropertyOptional({
    example: 7,
    description: '历史数据天数上限，null 表示不限时段',
  })
  @IsOptional()
  @IsInt({ message: '历史数据天数上限必须是整数' })
  historyLimitDays: number | null;

  @ApiPropertyOptional({
    example: 1,
    description: '空间数上限，null 表示不限制',
  })
  @IsOptional()
  @IsInt({ message: '空间数上限必须是整数' })
  spaceLimit: number | null;

  @ApiProperty({ example: false, description: '是否允许导出报表' })
  @IsBoolean({ message: '报表导出开关必须是布尔值' })
  canExportReport: boolean;

  @ApiProperty({ example: 0, description: '购买套餐赠送积分数' })
  @IsInt({ message: '赠送积分数必须是整数' })
  bonusPoints: number;

  @ApiProperty({ example: true, description: '是否允许访问首页' })
  @IsBoolean({ message: '首页访问权限必须是布尔值' })
  canAccessHome: boolean;

  @ApiProperty({ example: false, description: '是否允许访问进货管理' })
  @IsBoolean({ message: '进货管理权限必须是布尔值' })
  canAccessPurchaseManagement: boolean;

  @ApiProperty({ example: false, description: '是否允许访问经营分析' })
  @IsBoolean({ message: '经营分析权限必须是布尔值' })
  canAccessBusinessAnalysis: boolean;

  @ApiProperty({ example: false, description: '是否允许访问财务管理' })
  @IsBoolean({ message: '财务管理权限必须是布尔值' })
  canAccessFinance: boolean;

  @ApiProperty({ example: false, description: '是否允许访问营销中心' })
  @IsBoolean({ message: '营销中心权限必须是布尔值' })
  canAccessMarketing: boolean;

  @ApiProperty({ example: false, description: '是否允许访问员工管理' })
  @IsBoolean({ message: '员工管理权限必须是布尔值' })
  canAccessEmployeeManagement: boolean;

  @ApiProperty({ example: false, description: '是否允许访问报表中心' })
  @IsBoolean({ message: '报表中心权限必须是布尔值' })
  canAccessReportCenter: boolean;

  @ApiProperty({ example: false, description: '是否允许访问员工交班' })
  @IsBoolean({ message: '员工交班权限必须是布尔值' })
  canAccessHandover: boolean;

  @ApiProperty({ example: false, description: '是否允许配置子账号' })
  @IsBoolean({ message: '子账号配置权限必须是布尔值' })
  canUseSubAccount: boolean;
}

export class PlatformMembershipInfoDto {
  @ApiProperty({ example: true, description: '当前是否为有效会员' })
  @IsBoolean({ message: '会员状态必须是布尔值' })
  isActive: boolean;

  @ApiPropertyOptional({
    enum: [...PLATFORM_MEMBERSHIP_PLAN_IDS, 'developer'],
    description: '当前生效套餐标识，开发者模式返回 developer，无生效套餐时为空',
  })
  @IsOptional()
  @IsString({ message: '当前套餐标识必须是字符串' })
  planId: (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number] | 'developer' | null;

  @ApiPropertyOptional({
    example: 'ages会员',
    description: '面向前端展示的套餐名称，无特殊展示需求时为空',
  })
  @IsOptional()
  @IsString({ message: '展示套餐名称必须是字符串' })
  displayPlanName?: string | null;

  @ApiPropertyOptional({
    example: 1776153600000,
    description: '到期时间戳（ms），未开通时为空',
  })
  @IsOptional()
  @IsInt({ message: '到期时间必须是整数' })
  expiredAt: number | null;

  @ApiProperty({
    example: 'ABCD23',
    description: '邀请码（推广码）；门店尚未创建邀请码时为 null',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: '邀请码必须是字符串' })
  inviteCode: string | null;

  @ApiProperty({ example: 1880, description: '累计积分' })
  @IsInt({ message: '累计积分必须是整数' })
  totalPoints: number;

  @ApiProperty({ example: 1280, description: '可用积分' })
  @IsInt({ message: '可用积分必须是整数' })
  availablePoints: number;

  @ApiProperty({
    type: PlatformMembershipCapabilitiesDto,
    description: '当前生效套餐的能力矩阵（后端权威下发，前端不再本地推断）',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipCapabilitiesDto)
  capabilities: PlatformMembershipCapabilitiesDto;
}

export class PlatformMembershipApprovedPartnerDto {
  @ApiProperty({ example: '12', description: '正式合伙人档案 ID' })
  @IsString({ message: '正式合伙人档案 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '王建国', description: '合伙人姓名' })
  @IsString({ message: '合伙人姓名必须是字符串' })
  name: string;

  @ApiProperty({ example: '13800138000', description: '合伙人联系电话' })
  @IsString({ message: '联系电话必须是字符串' })
  phone: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar.jpg',
    description: '合伙人头像 URL，未设置时为空串',
  })
  @IsOptional()
  @IsString({ message: '头像 URL 必须是字符串' })
  avatarUrl?: string;

  @ApiPropertyOptional({
    example: 1747123200000,
    description: '成为合伙人的时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '成为合伙人的时间必须是整数' })
  joinedAt?: number;

  @ApiProperty({ example: 114, description: '当前可用纯利豆余额' })
  @IsInt({ message: '纯利豆余额必须是整数' })
  beanBalance: number;

  @ApiProperty({ example: 320, description: '累计获得纯利豆数量' })
  @IsInt({ message: '累计获得纯利豆数量必须是整数' })
  totalEarnedBeans: number;

  @ApiProperty({ example: 120, description: '累计提现纯利豆数量' })
  @IsInt({ message: '累计提现纯利豆数量必须是整数' })
  totalWithdrawnBeans: number;
}

export class PlatformMembershipProfileResponseDto {
  @ApiProperty({
    type: PlatformMembershipInfoDto,
    description: '会员中心头部信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipInfoDto)
  memberInfo: PlatformMembershipInfoDto;

  @ApiPropertyOptional({
    type: PlatformMembershipApprovedPartnerDto,
    description: '兼容旧前端的主合伙人摘要，无则为空',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartner: PlatformMembershipApprovedPartnerDto | null;

  @ApiProperty({
    type: [PlatformMembershipApprovedPartnerDto],
    description: '当前门店全部正式合伙人列表',
  })
  @IsArray({ message: '正式合伙人列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipApprovedPartnerDto)
  approvedPartners: PlatformMembershipApprovedPartnerDto[];
}

export class PlatformMembershipCenterStatsDto {
  @ApiProperty({ example: 2, description: '推广合伙人数量' })
  @IsInt({ message: '推广合伙人数量必须是整数' })
  partnerCount: number;

  @ApiProperty({ example: 8, description: '总推广人数' })
  @IsInt({ message: '总推广人数必须是整数' })
  totalPromos: number;

  @ApiProperty({ example: 3, description: '已充值推广人数' })
  @IsInt({ message: '已充值推广人数必须是整数' })
  chargedPromos: number;
}
