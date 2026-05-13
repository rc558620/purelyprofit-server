import { EmployeeLeaveType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateEmployeeLeaveDto {
  @ApiProperty({ enum: EmployeeLeaveType, description: '请假类型' })
  @IsEnum(EmployeeLeaveType, { message: '请假类型不合法' })
  type: EmployeeLeaveType;

  @ApiProperty({ example: 1741410000000, description: '开始时间戳（毫秒）' })
  @IsInt({ message: '开始时间必须是整数时间戳' })
  startDate: number;

  @ApiProperty({ example: 1741496400000, description: '结束时间戳（毫秒）' })
  @IsInt({ message: '结束时间必须是整数时间戳' })
  endDate: number;

  @ApiProperty({ example: 1.5, description: '请假天数' })
  @Min(0, { message: '请假天数不能为负数' })
  days: number;

  @ApiProperty({ example: true, description: '是否扣薪' })
  @IsBoolean({ message: '是否扣薪必须是布尔值' })
  deductSalary: boolean;

  @ApiProperty({ example: 120, description: '扣款金额（元）' })
  @Min(0, { message: '扣款金额不能为负数' })
  deductAmount: number;

  @ApiPropertyOptional({ example: '就医请假', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;
}

export class EmployeeLeaveResponseDto {
  @ApiProperty({ example: '1', description: '请假记录 ID' })
  @IsString({ message: '请假记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '1', description: '员工 ID' })
  @IsString({ message: '员工 ID 必须是字符串' })
  employeeId: string;

  @ApiProperty({ example: '张三', description: '员工姓名快照' })
  @IsString({ message: '员工姓名必须是字符串' })
  employeeName: string;

  @ApiProperty({ enum: EmployeeLeaveType, description: '请假类型' })
  @IsEnum(EmployeeLeaveType, { message: '请假类型不合法' })
  type: EmployeeLeaveType;

  @ApiProperty({ example: 1741410000000, description: '开始时间戳（毫秒）' })
  @IsInt({ message: '开始时间必须是整数时间戳' })
  startDate: number;

  @ApiProperty({ example: 1741496400000, description: '结束时间戳（毫秒）' })
  @IsInt({ message: '结束时间必须是整数时间戳' })
  endDate: number;

  @ApiProperty({ example: 1.5, description: '请假天数' })
  days: number;

  @ApiProperty({ example: true, description: '是否扣薪' })
  @IsBoolean({ message: '是否扣薪必须是布尔值' })
  deductSalary: boolean;

  @ApiProperty({ example: 120, description: '扣款金额（元）' })
  deductAmount: number;

  @ApiPropertyOptional({ example: '就医请假', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;

  @ApiProperty({ example: 1741323600000, description: '创建时间戳（毫秒）' })
  @IsInt({ message: '创建时间必须是整数时间戳' })
  createdAt: number;
}
