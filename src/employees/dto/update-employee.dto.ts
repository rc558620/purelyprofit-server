import { EmployeeGender } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ example: '张三', description: '员工姓名' })
  @IsOptional()
  @IsString({ message: '员工姓名必须是字符串' })
  @MinLength(2, { message: '员工姓名至少 2 位' })
  name?: string;

  @ApiPropertyOptional({ example: '13800138000', description: '手机号' })
  @IsOptional()
  @IsString({ message: '手机号必须是字符串' })
  @MinLength(6, { message: '手机号长度不合法' })
  phone?: string;

  @ApiPropertyOptional({ example: '服务员', description: '职位名称' })
  @IsOptional()
  @IsString({ message: '职位名称必须是字符串' })
  @MinLength(1, { message: '职位不能为空' })
  position?: string;

  @ApiPropertyOptional({ example: '前厅', description: '部门名称' })
  @IsOptional()
  @IsString({ message: '部门名称必须是字符串' })
  @MinLength(1, { message: '部门不能为空' })
  department?: string;

  @ApiPropertyOptional({
    example: 1740009600000,
    description: '入职日期时间戳（毫秒）',
  })
  @IsOptional()
  @IsInt({ message: '入职日期必须是整数时间戳' })
  joinDate?: number;

  @ApiPropertyOptional({ example: 4500, description: '底薪（元）' })
  @IsOptional()
  baseSalary?: number;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.jpg',
    description: '头像地址',
  })
  @IsOptional()
  @IsString({ message: '头像地址必须是字符串' })
  avatar?: string;

  @ApiPropertyOptional({
    example: '110101199001011234',
    description: '身份证号',
  })
  @IsOptional()
  @IsString({ message: '身份证号必须是字符串' })
  idCard?: string;

  @ApiPropertyOptional({ enum: EmployeeGender, description: '性别' })
  @IsOptional()
  @IsEnum(EmployeeGender, { message: '员工性别不合法' })
  gender?: EmployeeGender;

  @ApiPropertyOptional({ example: '李四', description: '紧急联系人' })
  @IsOptional()
  @IsString({ message: '紧急联系人必须是字符串' })
  emergencyContact?: string;

  @ApiPropertyOptional({ example: '13800138001', description: '紧急联系电话' })
  @IsOptional()
  @IsString({ message: '紧急联系电话必须是字符串' })
  emergencyPhone?: string;

  @ApiPropertyOptional({
    example: 1771545600000,
    description: '合同到期时间戳（毫秒）',
  })
  @IsOptional()
  @IsInt({ message: '合同到期日期必须是整数时间戳' })
  contractEndDate?: number;

  @ApiPropertyOptional({ example: '兼职晚班优先排班', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;
}
