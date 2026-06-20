import { StaffRole } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class UpdateStaffDto {
  @ApiPropertyOptional({ example: '李四', description: '员工姓名' })
  @IsOptional()
  @IsString({ message: '员工姓名必须是字符串' })
  @IsNotEmpty({ message: '员工姓名不能为空字符串' })
  @MinLength(2, { message: '员工姓名至少 2 位' })
  name?: string;

  @ApiPropertyOptional({ example: '13800138001', description: '员工手机号' })
  @IsOptional()
  @IsString({ message: '员工手机号必须是字符串' })
  phone?: string;

  @ApiPropertyOptional({ enum: StaffRole, description: '员工角色' })
  @IsOptional()
  @IsEnum(StaffRole, { message: '员工角色不合法' })
  role?: StaffRole;

  @ApiPropertyOptional({
    type: [String],
    description: '员工额外权限列表，传空数组表示只保留角色默认权限',
  })
  @IsOptional()
  @IsArray({ message: '员工额外权限列表必须是数组' })
  @IsString({ each: true, message: '员工额外权限项必须是字符串' })
  permissions?: string[];

  @ApiPropertyOptional({ example: true, description: '是否在职' })
  @IsOptional()
  @IsBoolean({ message: '是否在职必须是布尔值' })
  isActive?: boolean;
}
