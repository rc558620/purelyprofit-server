import { StaffRole } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateStaffDto {
  @ApiProperty({ example: 1, description: '所属门店 ID' })
  @IsInt({ message: '所属门店 ID 必须是整数' })
  storeId: number;

  @ApiProperty({ example: '李四', description: '员工姓名' })
  @IsString({ message: '员工姓名必须是字符串' })
  @MinLength(2, { message: '员工姓名至少 2 位' })
  name: string;

  @ApiPropertyOptional({ example: '13800138001', description: '员工手机号' })
  @IsOptional()
  @IsString({ message: '员工手机号必须是字符串' })
  phone?: string;

  @ApiProperty({ example: 'staff@example.com', description: '员工登录邮箱' })
  @IsEmail({}, { message: '员工邮箱格式不正确' })
  email: string;

  @ApiPropertyOptional({ enum: StaffRole, description: '员工角色' })
  @IsOptional()
  @IsEnum(StaffRole, { message: '员工角色不合法' })
  role?: StaffRole;

  @ApiPropertyOptional({
    type: [String],
    description: '员工额外权限列表，不传则使用角色默认权限',
  })
  @IsOptional()
  @IsArray({ message: '员工额外权限列表必须是数组' })
  @IsString({ each: true, message: '员工额外权限项必须是字符串' })
  permissions?: string[];
}
