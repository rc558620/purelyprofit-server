import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateEmployeeShiftDefinitionDto {
  @ApiPropertyOptional({
    example: 1,
    description: '所属门店 ID，不传时自动使用当前账号可管理门店',
  })
  @IsOptional()
  @IsInt({ message: '所属门店 ID 必须是整数' })
  @Min(1, { message: '所属门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ example: '早班', description: '班次名称' })
  @IsString({ message: '班次名称必须是字符串' })
  @MinLength(1, { message: '班次名称不能为空' })
  name: string;

  @ApiProperty({ example: '08:00', description: '默认上班时间' })
  @IsString({ message: '默认上班时间必须是字符串' })
  @MinLength(1, { message: '默认上班时间不能为空' })
  defaultStartTime: string;

  @ApiProperty({ example: '14:00', description: '默认下班时间' })
  @IsString({ message: '默认下班时间必须是字符串' })
  @MinLength(1, { message: '默认下班时间不能为空' })
  defaultEndTime: string;
}

export class UpdateEmployeeShiftDefinitionDto {
  @ApiPropertyOptional({ example: '晚班', description: '班次名称' })
  @IsOptional()
  @IsString({ message: '班次名称必须是字符串' })
  @MinLength(1, { message: '班次名称不能为空' })
  name?: string;

  @ApiPropertyOptional({ example: '18:00', description: '默认上班时间' })
  @IsOptional()
  @IsString({ message: '默认上班时间必须是字符串' })
  @MinLength(1, { message: '默认上班时间不能为空' })
  defaultStartTime?: string;

  @ApiPropertyOptional({ example: '23:00', description: '默认下班时间' })
  @IsOptional()
  @IsString({ message: '默认下班时间必须是字符串' })
  @MinLength(1, { message: '默认下班时间不能为空' })
  defaultEndTime?: string;
}

export class EmployeeShiftDefinitionResponseDto {
  @ApiProperty({ example: '1', description: '班次定义 ID' })
  @IsString({ message: '班次定义 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '早班', description: '班次名称' })
  @IsString({ message: '班次名称必须是字符串' })
  name: string;

  @ApiProperty({ example: '08:00', description: '默认上班时间' })
  @IsString({ message: '默认上班时间必须是字符串' })
  defaultStartTime: string;

  @ApiProperty({ example: '14:00', description: '默认下班时间' })
  @IsString({ message: '默认下班时间必须是字符串' })
  defaultEndTime: string;

  @ApiProperty({ example: 1748736000000, description: '创建时间戳（毫秒）' })
  @IsInt({ message: '创建时间必须是整数时间戳' })
  createdAt: number;

  @ApiProperty({ example: 1748736000000, description: '更新时间戳（毫秒）' })
  @IsInt({ message: '更新时间必须是整数时间戳' })
  updatedAt: number;
}
