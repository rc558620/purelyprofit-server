import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StaffRole } from '@prisma/client';
import { StoreResponseDto } from '../../stores/dto/store-response.dto';

export class ProfileMembershipDto {
  @ApiProperty({ example: 1, description: '员工关系 ID' })
  @IsInt({ message: '员工关系 ID 必须是整数' })
  staffId: number;

  @ApiProperty({ example: 1, description: '所属门店 ID' })
  @IsInt({ message: '所属门店 ID 必须是整数' })
  storeId: number;

  @ApiProperty({ enum: StaffRole, description: '当前门店角色' })
  @IsString({ message: '当前门店角色必须是字符串' })
  role: StaffRole;

  @ApiProperty({ type: [String], description: '当前门店权限列表' })
  @IsArray({ message: '当前门店权限列表必须是数组' })
  @IsString({ each: true, message: '权限项必须是字符串' })
  permissions: string[];

  @ApiProperty({ example: true, description: '当前门店关系是否启用' })
  @IsBoolean({ message: '当前门店关系启用状态必须是布尔值' })
  isActive: boolean;
}

export class ProfileUserDto {
  @ApiProperty({ example: 1, description: '用户 ID' })
  @IsInt({ message: '用户 ID 必须是整数' })
  id: number;

  @ApiProperty({ example: '13800138000', description: '手机号' })
  @IsString({ message: '手机号必须是字符串' })
  phone: string;

  @ApiPropertyOptional({
    example: 'phone_13800138000@purelyprofit.local',
    description: '账号邮箱占位字段',
  })
  @IsOptional()
  @IsString({ message: '邮箱必须是字符串' })
  email: string;

  @ApiPropertyOptional({ example: '老板', description: '用户名' })
  @IsOptional()
  @IsString({ message: '用户名必须是字符串' })
  name: string | null;

  @ApiProperty({
    example: '',
    description: '头像地址或 base64 数据，未设置时返回空串',
  })
  @IsString({ message: '头像必须是字符串' })
  avatar: string;

  @ApiProperty({ example: false, description: '是否已完成实名认证' })
  @IsBoolean({ message: '实名认证状态必须是布尔值' })
  verified: boolean;

  @ApiPropertyOptional({
    example: '张三',
    description: '实名认证姓名，未认证时为空',
  })
  @IsOptional()
  @IsString({ message: '实名认证姓名必须是字符串' })
  realName?: string;

  @ApiPropertyOptional({
    example: '110101********1234',
    description: '脱敏后的身份证号码，未认证时为空',
  })
  @IsOptional()
  @IsString({ message: '身份证号码必须是字符串' })
  idNumberMasked?: string;

  @ApiProperty({
    example: '2026-05-12T10:00:00.000Z',
    description: '创建时间',
  })
  @IsDate({ message: '创建时间必须是日期' })
  createdAt: Date;

  @ApiProperty({
    example: '2026-05-12T10:00:00.000Z',
    description: '更新时间',
  })
  @IsDate({ message: '更新时间必须是日期' })
  updatedAt: Date;
}

export class ProfileResponseDto {
  @ApiProperty({ type: ProfileUserDto, description: '当前登录用户信息' })
  @ValidateNested()
  @Type(() => ProfileUserDto)
  user: ProfileUserDto;

  @ApiPropertyOptional({
    type: StoreResponseDto,
    description: '当前账号绑定的门店信息',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => StoreResponseDto)
  store: StoreResponseDto | null;

  @ApiPropertyOptional({
    type: ProfileMembershipDto,
    description: '当前门店下的权限上下文',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileMembershipDto)
  currentMembership: ProfileMembershipDto | null;
}
