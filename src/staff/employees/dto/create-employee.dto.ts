import { EmployeeGender } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

export class CreateEmployeeDto {
  @ApiPropertyOptional({
    example: 1,
    description: '所属门店 ID，不传时自动使用当前账号可管理门店',
  })
  @IsOptional()
  @IsInt({ message: '所属门店 ID 必须是整数' })
  @Min(1, { message: '所属门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ example: '张三', description: '员工姓名' })
  @IsString({ message: '员工姓名必须是字符串' })
  @MinLength(2, { message: '员工姓名至少 2 位' })
  name: string;

  @ApiProperty({ example: '13800138000', description: '手机号' })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1\d{10}$/, { message: '请输入正确的 11 位手机号' })
  phone: string;

  @ApiProperty({ example: '服务员', description: '职位名称' })
  @IsString({ message: '职位名称必须是字符串' })
  @MinLength(1, { message: '职位不能为空' })
  position: string;

  @ApiProperty({ example: '前厅', description: '部门名称' })
  @IsString({ message: '部门名称必须是字符串' })
  @MinLength(1, { message: '部门不能为空' })
  department: string;

  @ApiProperty({
    example: 1740009600000,
    description: '入职日期时间戳（毫秒）',
  })
  @IsInt({ message: '入职日期必须是整数时间戳' })
  joinDate: number;

  @ApiProperty({ example: 4500, description: '底薪（元）' })
  @IsNumber({}, { message: '底薪必须是数字' })
  @Min(0, { message: '底薪不能为负数' })
  baseSalary: number;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.jpg',
    description: '头像地址',
  })
  @IsOptional()
  @IsString({ message: '头像地址必须是字符串' })
  avatar?: string;

  @ApiProperty({
    example: '110101199001011234',
    description: '身份证号',
  })
  @IsString({ message: '身份证号必须是字符串' })
  @Matches(/^\d{17}[\dXx]$/, { message: '身份证号格式不正确（18位）' })
  idCard: string;

  @ApiPropertyOptional({
    enum: EmployeeGender,
    description: '性别，默认 unset',
  })
  @IsOptional()
  @IsEnum(EmployeeGender, { message: '员工性别不合法' })
  gender?: EmployeeGender;

  @ApiProperty({ example: '李四', description: '紧急联系人' })
  @IsString({ message: '紧急联系人必须是字符串' })
  @MinLength(1, { message: '紧急联系人不能为空' })
  emergencyContact: string;

  @ApiProperty({ example: '13800138001', description: '紧急联系电话' })
  @IsString({ message: '紧急联系电话必须是字符串' })
  @Matches(/^1\d{10}$/, { message: '请输入正确的 11 位紧急联系电话' })
  emergencyPhone: string;

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
