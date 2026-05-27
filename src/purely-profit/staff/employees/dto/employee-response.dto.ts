import { EmployeeGender, EmployeeStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  PaginationMetaDto,
  PaginationQueryDto,
  transformOptionalBoolean,
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../../stores/dto/store-response.dto';

export class ListEmployeesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '按门店 ID 筛选员工' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    enum: EmployeeStatus,
    description: '按员工状态筛选',
  })
  @IsOptional()
  @IsEnum(EmployeeStatus, { message: '员工状态不合法' })
  status?: EmployeeStatus;

  @ApiPropertyOptional({ example: '前厅', description: '按部门筛选' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '部门名称必须是字符串' })
  department?: string;

  @ApiPropertyOptional({
    example: '张三',
    description: '按员工姓名、编号、手机号、职位或部门搜索',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '搜索关键词必须是字符串' })
  keyword?: string;
}

export class EmployeesOverviewQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '指定门店 ID，不传则聚合全部可管理门店',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}

export class EmployeeResponseDto {
  @ApiProperty({ example: '1', description: '员工 ID' })
  @IsString({ message: '员工 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: 'EMP001', description: '员工编号' })
  @IsString({ message: '员工编号必须是字符串' })
  empNo: string;

  @ApiProperty({ example: '张三', description: '员工姓名' })
  @IsString({ message: '员工姓名必须是字符串' })
  name: string;

  @ApiProperty({ example: '13800138000', description: '手机号' })
  @IsString({ message: '手机号必须是字符串' })
  phone: string;

  @ApiProperty({ example: '服务员', description: '职位名称' })
  @IsString({ message: '职位名称必须是字符串' })
  position: string;

  @ApiProperty({ example: '前厅', description: '部门名称' })
  @IsString({ message: '部门名称必须是字符串' })
  department: string;

  @ApiProperty({
    example: 1740009600000,
    description: '入职日期时间戳（毫秒）',
  })
  @IsInt({ message: '入职日期必须是整数时间戳' })
  joinDate: number;

  @ApiProperty({ example: 4500, description: '底薪（元）' })
  baseSalary: number;

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

  @ApiProperty({ enum: EmployeeGender, description: '性别' })
  @IsEnum(EmployeeGender, { message: '员工性别不合法' })
  gender: EmployeeGender;

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

  @ApiProperty({ enum: EmployeeStatus, description: '员工状态' })
  @IsEnum(EmployeeStatus, { message: '员工状态不合法' })
  status: EmployeeStatus;

  @ApiPropertyOptional({
    example: 1742601600000,
    description: '离职时间戳（毫秒）',
  })
  @IsOptional()
  @IsInt({ message: '离职日期必须是整数时间戳' })
  resignDate?: number;

  @ApiPropertyOptional({ example: '个人原因', description: '离职原因' })
  @IsOptional()
  @IsString({ message: '离职原因必须是字符串' })
  resignReason?: string;

  @ApiProperty({ example: 1740009600000, description: '创建时间戳（毫秒）' })
  @IsInt({ message: '创建时间必须是整数时间戳' })
  createdAt: number;

  @ApiProperty({ example: 1740096000000, description: '更新时间戳（毫秒）' })
  @IsInt({ message: '更新时间必须是整数时间戳' })
  updatedAt: number;
}

export class PaginatedEmployeesResponseDto {
  @ApiProperty({ type: [EmployeeResponseDto], description: '员工列表' })
  items: EmployeeResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页元信息' })
  meta: PaginationMetaDto;
}

export class EmployeesOverviewResponseDto {
  @ApiProperty({ example: 12, description: '在职人数' })
  @IsInt({ message: '在职人数必须是整数' })
  activeCount: number;

  @ApiProperty({ example: 3, description: '离职员工总人数' })
  @IsInt({ message: '离职员工总人数必须是整数' })
  resignedCount: number;

  @ApiProperty({ example: 6, description: '本月总请假天数' })
  leaveDaysThisMonth: number;

  @ApiProperty({ example: 4, description: '本月待结算工资人数' })
  @IsInt({ message: '本月待结算工资人数必须是整数' })
  pendingPayrollCount: number;

  @ApiProperty({ example: 1, description: '本月离职人数' })
  @IsInt({ message: '本月离职人数必须是整数' })
  resignedThisMonth: number;
}

export class EmployeeDateFilterQueryDto {
  @ApiPropertyOptional({ example: 1, description: '按门店 ID 筛选' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({ example: '1', description: '按员工 ID 筛选' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '员工 ID 必须是整数' })
  @Min(1, { message: '员工 ID 必须大于等于 1' })
  employeeId?: number;

  @ApiPropertyOptional({ example: '前厅', description: '按部门筛选' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '部门名称必须是字符串' })
  department?: string;

  @ApiPropertyOptional({ example: 2026, description: '年份' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '年份必须是整数' })
  @Min(2000, { message: '年份不能早于 2000' })
  @Max(2100, { message: '年份不能晚于 2100' })
  year?: number;

  @ApiPropertyOptional({ example: 4, description: '月份，0 表示全年' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '月份必须是整数' })
  @Min(0, { message: '月份不能小于 0' })
  @Max(12, { message: '月份不能大于 12' })
  month?: number;

  @ApiPropertyOptional({
    example: false,
    description: '是否按导出模式拉取数据',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: '导出标记必须是布尔值' })
  export?: boolean;
}
