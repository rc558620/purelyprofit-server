import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoreSubAccountStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import type { ProfitHomeModule } from '../../access-control/subject-capability.service';

export class AuthCapabilityResponseDto {
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

  @ApiProperty({ example: 3, description: '当前门店可配置的子账号额度' })
  @IsInt()
  subAccountQuota: number;

  @ApiProperty({ example: true, description: '当前门店是否启用子账号能力' })
  @IsBoolean()
  subAccountEnabled: boolean;

  @ApiProperty({
    example: ['additional', 'business-analysis', 'finance-center'],
    description: '允许访问的首页模块列表',
  })
  @IsArray()
  @IsString({ each: true })
  allowedHomeModules: ProfitHomeModule[];

  @ApiProperty({
    example: ['store-settings'],
    description: '隐藏的首页模块列表',
  })
  @IsArray()
  @IsString({ each: true })
  hiddenHomeModules: ProfitHomeModule[];

  @ApiProperty({ example: true, description: '是否可以访问财务中心' })
  @IsBoolean()
  canViewFinance: boolean;

  @ApiProperty({ example: true, description: '是否可以访问营销中心' })
  @IsBoolean()
  canViewMarketing: boolean;

  @ApiProperty({
    example: false,
    description: '是否可以显示商品管理首页入口，不等同于 goods:view 接口权限',
  })
  @IsBoolean()
  canUseGoodsManagement: boolean;

  @ApiProperty({ example: true, description: '是否可以使用交班管理' })
  @IsBoolean()
  canUseHandoverManagement: boolean;

  @ApiProperty({ example: true, description: '是否可以使用空间管理' })
  @IsBoolean()
  canUseSpaceManagement: boolean;

  @ApiProperty({ example: false, description: '是否可以访问门店设置' })
  @IsBoolean()
  canAccessStoreSettings: boolean;
}
