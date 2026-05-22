import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { StaffRole, StaffStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  PaginationMetaDto,
  PaginationQueryDto,
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../../stores/dto/store-response.dto';

export class ListStaffQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '按门店 ID 筛选员工' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    enum: StaffStatus,
    description: '按员工席位状态筛选',
  })
  @IsOptional()
  @IsEnum(StaffStatus, { message: '员工席位状态不合法' })
  status?: StaffStatus;

  @ApiPropertyOptional({ enum: StaffRole, description: '按员工角色筛选' })
  @IsOptional()
  @IsEnum(StaffRole, { message: '员工角色不合法' })
  role?: StaffRole;

  @ApiPropertyOptional({
    example: '李四',
    description: '按员工姓名、邮箱或手机号模糊搜索',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '搜索关键词必须是字符串' })
  keyword?: string;
}

export class StaffResponseDto {
  @ApiProperty({ example: 1, description: '员工 ID' })
  @IsInt({ message: '员工 ID 必须是整数' })
  id: number;

  @ApiProperty({ example: 1, description: '所属门店 ID' })
  @IsInt({ message: '所属门店 ID 必须是整数' })
  storeId: number;

  @ApiPropertyOptional({ example: 1, description: '绑定用户 ID' })
  @IsOptional()
  @IsInt({ message: '绑定用户 ID 必须是整数' })
  userId: number | null;

  @ApiProperty({ example: 'staff@example.com', description: '员工登录邮箱' })
  @IsString({ message: '员工邮箱必须是字符串' })
  email: string;

  @ApiProperty({ example: '李四', description: '员工姓名' })
  @IsString({ message: '员工姓名必须是字符串' })
  name: string;

  @ApiPropertyOptional({ example: '13800138001', description: '员工手机号' })
  @IsOptional()
  @IsString({ message: '员工手机号必须是字符串' })
  phone: string | null;

  @ApiProperty({ enum: StaffRole, description: '员工角色' })
  @IsEnum(StaffRole, { message: '员工角色不合法' })
  role: StaffRole;

  @ApiProperty({ type: [String], description: '员工额外权限列表' })
  @IsArray({ message: '员工额外权限列表必须是数组' })
  @IsString({ each: true, message: '员工额外权限项必须是字符串' })
  permissions: string[];

  @ApiProperty({ enum: StaffStatus, description: '员工席位状态' })
  @IsEnum(StaffStatus, { message: '员工席位状态不合法' })
  status: StaffStatus;

  @ApiProperty({ example: true, description: '是否占用账号席位' })
  @IsBoolean({ message: '账号席位占用状态必须是布尔值' })
  isSeatActive: boolean;

  @ApiProperty({ example: true, description: '是否在职' })
  @IsBoolean({ message: '是否在职必须是布尔值' })
  isActive: boolean;

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

export class PaginatedStaffResponseDto {
  @ApiProperty({ type: [StaffResponseDto], description: '当前页员工列表' })
  items: StaffResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页元信息' })
  meta: PaginationMetaDto;
}
