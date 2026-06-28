import { EmployeePayrollStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EmployeeDateFilterQueryDto } from './employee-response.dto';
import { PaginationMetaDto } from '../../../stores/dto/store-response.dto';

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

  @ApiPropertyOptional({
    example: '张三',
    description: '兼容前端本地模型透传的员工姓名快照，服务端会自行生成',
  })
  @IsOptional()
  @IsString({ message: '员工姓名必须是字符串' })
  employeeName?: string;

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

export class UpdateEmployeePayrollDto {
  @ApiPropertyOptional({ example: 4500, description: '底薪（元）' })
  @IsOptional()
  @Min(0, { message: '底薪不能为负数' })
  baseSalary?: number;

  @ApiPropertyOptional({ example: 120, description: '请假扣款（元）' })
  @IsOptional()
  @Min(0, { message: '请假扣款不能为负数' })
  leaveDeduction?: number;

  @ApiPropertyOptional({ example: 50, description: '其他扣款（元）' })
  @IsOptional()
  @Min(0, { message: '其他扣款不能为负数' })
  otherDeduction?: number;

  @ApiPropertyOptional({ example: '迟到罚款', description: '其他扣款说明' })
  @IsOptional()
  @IsString({ message: '其他扣款说明必须是字符串' })
  otherDeductionNote?: string;

  @ApiPropertyOptional({ example: 300, description: '奖金（元）' })
  @IsOptional()
  @Min(0, { message: '奖金不能为负数' })
  bonus?: number;

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

  @ApiPropertyOptional({
    example: 4630,
    description: '兼容前端本地模型透传的实发工资，服务端会重新计算',
  })
  @IsOptional()
  @Min(0, { message: '实发工资不能为负数' })
  actualSalary?: number;

  @ApiPropertyOptional({
    example: 5330,
    description: '兼容前端本地模型透传的人力总成本，服务端会重新计算',
  })
  @IsOptional()
  @Min(0, { message: '人力总成本不能为负数' })
  totalLaborCost?: number;

  @ApiPropertyOptional({
    enum: EmployeePayrollStatus,
    description: '兼容前端本地模型透传的工资状态，服务端编辑草稿时不会直接采用',
  })
  @IsOptional()
  @IsEnum(EmployeePayrollStatus, { message: '工资状态不合法' })
  status?: EmployeePayrollStatus;

  @ApiPropertyOptional({
    example: 1743508800000,
    description: '兼容前端本地模型透传的确认时间，服务端不会直接采用',
  })
  @IsOptional()
  @IsInt({ message: '确认结算时间必须是整数时间戳' })
  confirmedAt?: number;
}

export class EmployeePayrollReportSummaryDto {
  @ApiProperty({ example: 8, description: '已结算工资总数' })
  @IsInt({ message: '已结算工资总数必须是整数' })
  confirmedCount: number;

  @ApiProperty({ example: 36800, description: '实发工资合计（元）' })
  @IsNumber({}, { message: '实发工资合计必须是数字' })
  totalActualSalary: number;

  @ApiProperty({ example: 42100, description: '人力总成本合计（元）' })
  @IsNumber({}, { message: '人力总成本合计必须是数字' })
  totalLaborCost: number;

  @ApiProperty({ example: 4600, description: '平均实发工资（元）' })
  @IsNumber({}, { message: '平均实发工资必须是数字' })
  avgActualSalary: number;
}

export class EmployeePayrollReportRowDto {
  @ApiProperty({ example: '1', description: '工资记录 ID' })
  @IsString({ message: '工资记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '张三', description: '员工姓名' })
  @IsString({ message: '员工姓名必须是字符串' })
  employeeName: string;

  @ApiProperty({ example: '2026-05', description: '结算月份' })
  @IsString({ message: '结算月份必须是字符串' })
  month: string;

  @ApiProperty({ example: 4500, description: '底薪（元）' })
  @IsNumber({}, { message: '底薪必须是数字' })
  baseSalary: number;

  @ApiProperty({ example: 120, description: '请假扣款（元）' })
  @IsNumber({}, { message: '请假扣款必须是数字' })
  leaveDeduction: number;

  @ApiProperty({ example: 50, description: '其他扣款（元）' })
  @IsNumber({}, { message: '其他扣款必须是数字' })
  otherDeduction: number;

  @ApiProperty({ example: 300, description: '奖金（元）' })
  @IsNumber({}, { message: '奖金必须是数字' })
  bonus: number;

  @ApiProperty({ example: 4630, description: '实发工资（元）' })
  @IsNumber({}, { message: '实发工资必须是数字' })
  actualSalary: number;

  @ApiPropertyOptional({ example: 500, description: '社保企业部分（元）' })
  @IsOptional()
  @IsNumber({}, { message: '社保企业部分必须是数字' })
  socialInsurance?: number;

  @ApiPropertyOptional({ example: 200, description: '公积金企业部分（元）' })
  @IsOptional()
  @IsNumber({}, { message: '公积金企业部分必须是数字' })
  housingFund?: number;

  @ApiProperty({ example: 5330, description: '总人力成本（元）' })
  @IsNumber({}, { message: '总人力成本必须是数字' })
  totalLaborCost: number;

  @ApiPropertyOptional({
    example: 1743508800000,
    description: '确认结算时间戳（毫秒）',
  })
  @IsOptional()
  @IsInt({ message: '确认结算时间必须是整数时间戳' })
  confirmedAt?: number;
}

export class EmployeePayrollReportResponseDto {
  @ApiProperty({
    type: EmployeePayrollReportSummaryDto,
    description: '工资报表概况',
  })
  @ValidateNested()
  @Type(() => EmployeePayrollReportSummaryDto)
  summary: EmployeePayrollReportSummaryDto;

  @ApiProperty({
    type: [EmployeePayrollReportRowDto],
    description: '工资报表明细',
  })
  @IsArray({ message: '工资报表明细必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => EmployeePayrollReportRowDto)
  rows: EmployeePayrollReportRowDto[];
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

export class PaginatedEmployeePayrollsResponseDto {
  @ApiProperty({ type: [EmployeePayrollResponseDto], description: '工资列表' })
  @IsArray({ message: '工资列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => EmployeePayrollResponseDto)
  items: EmployeePayrollResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页元信息' })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta: PaginationMetaDto;
}
