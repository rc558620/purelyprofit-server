import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EmployeeDateFilterQueryDto } from './employee-response.dto';
import { PaginationMetaDto } from '../../../stores/dto/store-response.dto';

export class ListEmployeeShiftsQueryDto extends EmployeeDateFilterQueryDto {}

export class CreateEmployeeShiftDto {
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

  @ApiProperty({
    example: 1741344000000,
    description: '排班日期时间戳（毫秒）',
  })
  @IsInt({ message: '排班日期必须是整数时间戳' })
  date: number;

  @ApiProperty({ example: '1', description: '班次定义 ID' })
  @IsInt({ message: '班次定义 ID 必须是整数' })
  @Min(1, { message: '班次定义 ID 必须大于等于 1' })
  shiftDefinitionId: number;

  @ApiPropertyOptional({
    example: '08:00',
    description: '兼容旧版前端直传的上班时间，服务端会以班次定义为准',
    deprecated: true,
  })
  @IsOptional()
  @IsString({ message: '上班时间必须是字符串' })
  startTime?: string;

  @ApiPropertyOptional({
    example: '14:00',
    description: '兼容旧版前端直传的下班时间，服务端会以班次定义为准',
    deprecated: true,
  })
  @IsOptional()
  @IsString({ message: '下班时间必须是字符串' })
  endTime?: string;

  @ApiPropertyOptional({ example: '顶班', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;
}

export class UpdateEmployeeShiftDto {
  @ApiPropertyOptional({
    example: 1741344000000,
    description: '排班日期时间戳（毫秒）',
  })
  @IsOptional()
  @IsInt({ message: '排班日期必须是整数时间戳' })
  date?: number;

  @ApiPropertyOptional({ example: '1', description: '班次定义 ID' })
  @IsOptional()
  @IsInt({ message: '班次定义 ID 必须是整数' })
  @Min(1, { message: '班次定义 ID 必须大于等于 1' })
  shiftDefinitionId?: number;

  @ApiPropertyOptional({
    example: '08:00',
    description: '兼容旧版前端直传的上班时间，服务端会以班次定义为准',
    deprecated: true,
  })
  @IsOptional()
  @IsString({ message: '上班时间必须是字符串' })
  startTime?: string;

  @ApiPropertyOptional({
    example: '14:00',
    description: '兼容旧版前端直传的下班时间，服务端会以班次定义为准',
    deprecated: true,
  })
  @IsOptional()
  @IsString({ message: '下班时间必须是字符串' })
  endTime?: string;

  @ApiPropertyOptional({ example: '顶班', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;
}

export class EmployeeShiftDefinitionCountDto {
  @ApiPropertyOptional({
    example: '1',
    description: '班次定义 ID，历史数据可为空',
  })
  @IsOptional()
  @IsString({ message: '班次定义 ID 必须是字符串' })
  shiftDefinitionId?: string;

  @ApiProperty({ example: '早班', description: '班次名称' })
  @IsString({ message: '班次名称必须是字符串' })
  shiftName: string;

  @ApiProperty({ example: 4, description: '班次数' })
  @IsInt({ message: '班次数必须是整数' })
  count: number;
}

export class EmployeeShiftReportSummaryDto {
  @ApiProperty({ example: 18, description: '总班次数' })
  @IsInt({ message: '总班次数必须是整数' })
  totalShifts: number;

  @ApiProperty({ example: 6, description: '参与员工数（去重）' })
  @IsInt({ message: '参与员工数必须是整数' })
  employeeCount: number;

  @ApiProperty({
    type: [EmployeeShiftDefinitionCountDto],
    description: '按班次定义/名称聚合的班次数',
  })
  @IsArray({ message: '班次统计必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => EmployeeShiftDefinitionCountDto)
  definitionCounts: EmployeeShiftDefinitionCountDto[];
}

export class EmployeeShiftReportRowDto {
  @ApiProperty({ example: '1', description: '排班记录 ID' })
  @IsString({ message: '排班记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '05/14 周四', description: '日期标签' })
  @IsString({ message: '日期标签必须是字符串' })
  dateLabel: string;

  @ApiProperty({ example: '张三', description: '员工姓名' })
  @IsString({ message: '员工姓名必须是字符串' })
  employeeName: string;

  @ApiPropertyOptional({
    example: '1',
    description: '班次定义 ID，历史数据可为空',
  })
  @IsOptional()
  @IsString({ message: '班次定义 ID 必须是字符串' })
  shiftDefinitionId?: string;

  @ApiProperty({ example: '早班', description: '班次名称' })
  @IsString({ message: '班次名称必须是字符串' })
  shiftName: string;

  @ApiProperty({ example: '08:00', description: '上班时间' })
  @IsString({ message: '上班时间必须是字符串' })
  startTime: string;

  @ApiProperty({ example: '14:00', description: '下班时间' })
  @IsString({ message: '下班时间必须是字符串' })
  endTime: string;
}

export class EmployeeShiftReportResponseDto {
  @ApiProperty({
    type: EmployeeShiftReportSummaryDto,
    description: '排班报表概况',
  })
  @ValidateNested()
  @Type(() => EmployeeShiftReportSummaryDto)
  summary: EmployeeShiftReportSummaryDto;

  @ApiProperty({
    type: [EmployeeShiftReportRowDto],
    description: '排班报表明细',
  })
  @IsArray({ message: '排班报表明细必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => EmployeeShiftReportRowDto)
  rows: EmployeeShiftReportRowDto[];
}

export class EmployeeShiftResponseDto {
  @ApiProperty({ example: '1', description: '排班记录 ID' })
  @IsString({ message: '排班记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '1', description: '员工 ID' })
  @IsString({ message: '员工 ID 必须是字符串' })
  employeeId: string;

  @ApiProperty({ example: '张三', description: '员工姓名快照' })
  @IsString({ message: '员工姓名必须是字符串' })
  employeeName: string;

  @ApiProperty({
    example: 1741344000000,
    description: '排班日期时间戳（毫秒）',
  })
  @IsInt({ message: '排班日期必须是整数时间戳' })
  date: number;

  @ApiPropertyOptional({
    example: '1',
    description: '班次定义 ID，历史数据可为空',
  })
  @IsOptional()
  @IsString({ message: '班次定义 ID 必须是字符串' })
  shiftDefinitionId?: string;

  @ApiProperty({ example: '早班', description: '班次名称快照' })
  @IsString({ message: '班次名称必须是字符串' })
  shiftName: string;

  @ApiProperty({ example: '08:00', description: '上班时间' })
  @IsString({ message: '上班时间必须是字符串' })
  startTime: string;

  @ApiProperty({ example: '14:00', description: '下班时间' })
  @IsString({ message: '下班时间必须是字符串' })
  endTime: string;

  @ApiPropertyOptional({ example: '顶班', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;

  @ApiProperty({ example: 1741323600000, description: '创建时间戳（毫秒）' })
  @IsInt({ message: '创建时间必须是整数时间戳' })
  createdAt: number;
}

export class PaginatedEmployeeShiftsResponseDto {
  @ApiProperty({ type: [EmployeeShiftResponseDto], description: '排班列表' })
  @IsArray({ message: '排班列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => EmployeeShiftResponseDto)
  items: EmployeeShiftResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页元信息' })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta: PaginationMetaDto;
}
