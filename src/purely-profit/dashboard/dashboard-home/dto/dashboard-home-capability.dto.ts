import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoreSubAccountStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import type { ProfitHomeModule } from '../../../access-control/subject-capability.service';

/** 首页用户能力快照：决定前端展示哪些首页模块 */
export class DashboardHomeCapabilityDto {
  @ApiProperty({
    example: 'owner',
    description: '身份类型: owner/staff/sub_account',
  })
  @IsString()
  identityType: string;

  @ApiPropertyOptional({
    example: 'cashier',
    description: '子账号角色，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsString()
  subAccountRole?: string;

  @ApiPropertyOptional({
    example: '收银员',
    description: '子账号角色中文标识，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsString()
  subAccountRoleLabel?: string;

  @ApiProperty({
    example: ['additional', 'business-analysis', 'finance-center'],
    description: '允许访问的首页模块列表',
  })
  @IsArray({ message: '允许模块必须是数组' })
  @IsString({ each: true })
  allowedHomeModules: ProfitHomeModule[];

  @ApiProperty({
    example: ['store-settings'],
    description: '隐藏的首页模块列表',
  })
  @IsArray({ message: '隐藏模块必须是数组' })
  @IsString({ each: true })
  hiddenHomeModules: ProfitHomeModule[];

  @ApiProperty({
    example: true,
    description: '是否可以访问财务中心',
  })
  @IsBoolean()
  canViewFinance: boolean;

  @ApiProperty({
    example: true,
    description: '是否可以访问营销中心',
  })
  @IsBoolean()
  canViewMarketing: boolean;

  @ApiProperty({
    example: false,
    description: '是否可以显示商品管理首页入口，不等同于 goods:view 接口权限',
  })
  @IsBoolean()
  canUseGoodsManagement: boolean;

  @ApiPropertyOptional({
    enum: StoreSubAccountStatus,
    example: StoreSubAccountStatus.active,
    description: '子账号状态，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsString()
  subAccountStatus?: StoreSubAccountStatus;

  @ApiPropertyOptional({
    example: true,
    description:
      '子账号是否已绑定岗位，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsBoolean()
  subAccountAssigned?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      '子账号是否允许访问首页，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsBoolean()
  canAccessHome?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      '子账号是否允许使用交班，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsBoolean()
  canUseHandover?: boolean;

  @ApiProperty({
    example: true,
    description: '是否可以使用交班管理',
  })
  @IsBoolean()
  canUseHandoverManagement: boolean;

  @ApiProperty({
    example: true,
    description: '是否可以使用空间管理',
  })
  @IsBoolean()
  canUseSpaceManagement: boolean;

  @ApiProperty({
    example: false,
    description: '是否可以访问门店设置',
  })
  @IsBoolean()
  canAccessStoreSettings: boolean;

  @ApiProperty({
    example: true,
    description: '是否可以访问首页概览接口',
  })
  @IsBoolean()
  canAccessDashboardOverview: boolean;
}

/** 首页新用户额度摘要：用于首页「最新动态」额度预警 */
export class DashboardHomeQuotaDto {
  @ApiProperty({ description: '剩余新用户额度（位新客）' })
  @IsInt()
  remaining!: number;

  @ApiProperty({ description: '预警阈值（位新客），低于该值时提醒' })
  @IsInt()
  warningThreshold!: number;

  /**
   * 累计充值/赠送/消耗。前端据此判断门店是否真的用过额度：
   * 从未有过流水的门店 remaining 天然为 0，不能当成「额度已用完」告警。
   */
  @ApiProperty({ description: '累计充值获得（位新客）' })
  @IsInt()
  totalRecharged!: number;

  @ApiProperty({ description: '累计会员赠送（位新客）' })
  @IsInt()
  totalGranted!: number;

  @ApiProperty({ description: '累计已服务新客（位新客）' })
  @IsInt()
  totalConsumed!: number;
}
