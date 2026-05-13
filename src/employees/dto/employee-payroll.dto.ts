import { EmployeePayrollStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { EmployeeDateFilterQueryDto } from './employee-response.dto';

export class ListEmployeePayrollsQueryDto extends EmployeeDateFilterQueryDto {
  @ApiPropertyOptional({
    enum: EmployeePayrollStatus,
    description: '按工资状态筛选',
  })
  @IsOptional()
  @IsEnum(EmployeePayrollStatus, { message: '工资状态不合法' })
  status?: EmployeePayrollStatus;
}

export class SaveEmployeePayrollDto {
  @ApiProperty({ example: '1', description: '员工 ID' })
  @IsInt({ message: '员工 ID 必须是整数' })
  @Min(1, { message: '员工 ID 必须大于等于 1' })
  employeeId: number;

  @ApiProperty({ example: '2026-04', description: '结算月份，格式 YYYY-MM' })
  @Matches(/^\d{4}-\d{2}$/, { message: '结算月份格式必须为 YYYY-MM' })
  month: string;

  @ApiProperty({ example: 4500, description: '底薪（元）' })
  @Min(0, { message: '底薪不能为负数' })
  baseSalary: number;

  @ApiProperty({ example: 120, description: '请假扣款（元）' })
  @Min(0, { message: '请假扣款不能为负数' })
  leaveDeduction: number;

  @ApiProperty({ example: 50, description: '其他扣款（元）' })
  @Min(0, { message: '其他扣款不能为负数' })
  otherDeduction: number;

  @ApiPropertyOptional({ example: '迟到罚款', description: '其他扣款说明' })
  @IsOptional()
  @IsString({ message: '其他扣款说明必须是字符串' })
  otherDeductionNote?: string;

  @ApiProperty({ example: 300, description: '奖金（元）' })
  @Min(0, { message: '奖金不能为负数' })
  bonus: number;

  @ApiPropertyOptional({ example: 500, description: '社保企业部分（元）' })
  @IsOptional()
  @Min(0, { message: '社保企业部分不能为负数' })
  socialInsurance?: number;

  @ApiPropertyOptional({ example: 200, description: '公积金企业部分（元）' })
  @IsOptional()
  @Min(0, { message: '公积金企业部分不能为负数' })
  housingFund?: number;

  @ApiPropertyOptional({ example: '含加班补贴', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;
}

export class EmployeePayrollResponseDto {
  @ApiProperty({ example: '1', description: '工资记录 ID' })
  @IsString({ message: '工资记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '1', description: '员工 ID' })
  @IsString({ message: '员工 ID 必须是字符串' })
  employeeId: string;

  @ApiProperty({ example: '张三', description: '员工姓名快照' })
  @IsString({ message: '员工姓名必须是字符串' })
  employeeName: string;

  @ApiProperty({ example: '2026-04', description: '结算月份，格式 YYYY-MM' })
  @IsString({ message: '结算月份必须是字符串' })
  month: string;

  @ApiProperty({ example: 4500, description: '底薪（元）' })
  baseSalary: number;

  @ApiProperty({ example: 120, description: '请假扣款（元）' })
  leaveDeduction: number;

  @ApiProperty({ example: 50, description: '其他扣款（元）' })
  otherDeduction: number;

  @ApiPropertyOptional({ example: '迟到罚款', description: '其他扣款说明' })
  @IsOptional()
  @IsString({ message: '其他扣款说明必须是字符串' })
  otherDeductionNote?: string;

  @ApiProperty({ example: 300, description: '奖金（元）' })
  bonus: number;

  @ApiProperty({ example: 4630, description: '实发工资（元）' })
  actualSalary: number;

  @ApiPropertyOptional({ example: 500, description: '社保企业部分（元）' })
  socialInsurance?: number;

  @ApiPropertyOptional({ example: 200, description: '公积金企业部分（元）' })
  housingFund?: number;

  @ApiProperty({ example: 5330, description: '总人力成本（元）' })
  totalLaborCost: number;

  @ApiProperty({ enum: EmployeePayrollStatus, description: '工资状态' })
  @IsEnum(EmployeePayrollStatus, { message: '工资状态不合法' })
  status: EmployeePayrollStatus;

  @ApiPropertyOptional({
    example: 1743508800000,
    description: '确认结算时间戳（毫秒）',
  })
  @IsOptional()
  @IsInt({ message: '确认结算时间必须是整数时间戳' })
  confirmedAt?: number;

  @ApiPropertyOptional({ example: '含加班补贴', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;

  @ApiProperty({ example: 1741323600000, description: '创建时间戳（毫秒）' })
  @IsInt({ message: '创建时间必须是整数时间戳' })
  createdAt: number;

  @ApiProperty({ example: 1741410000000, description: '更新时间戳（毫秒）' })
  @IsInt({ message: '更新时间必须是整数时间戳' })
  updatedAt: number;
}
