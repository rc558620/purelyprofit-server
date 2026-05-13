import { EmployeeShiftType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { EmployeeDateFilterQueryDto } from './employee-response.dto';

export class ListEmployeeShiftsQueryDto extends EmployeeDateFilterQueryDto {}

export class CreateEmployeeShiftDto {
  @ApiProperty({ example: '1', description: '员工 ID' })
  @IsInt({ message: '员工 ID 必须是整数' })
  @Min(1, { message: '员工 ID 必须大于等于 1' })
  employeeId: number;

  @ApiProperty({
    example: 1741344000000,
    description: '排班日期时间戳（毫秒）',
  })
  @IsInt({ message: '排班日期必须是整数时间戳' })
  date: number;

  @ApiProperty({ enum: EmployeeShiftType, description: '班次类型' })
  @IsEnum(EmployeeShiftType, { message: '班次类型不合法' })
  shiftType: EmployeeShiftType;

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

  @ApiProperty({ enum: EmployeeShiftType, description: '班次类型' })
  @IsEnum(EmployeeShiftType, { message: '班次类型不合法' })
  shiftType: EmployeeShiftType;

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
