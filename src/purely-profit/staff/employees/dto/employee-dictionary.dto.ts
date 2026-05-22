import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';

export class EmployeeStoreQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '门店 ID，不传时自动推断唯一可管理门店',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}

export class CreateEmployeeDictionaryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '所属门店 ID，不传时自动使用当前账号可管理门店',
  })
  @IsOptional()
  @IsInt({ message: '所属门店 ID 必须是整数' })
  @Min(1, { message: '所属门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ example: '前厅', description: '名称' })
  @IsString({ message: '名称必须是字符串' })
  @MinLength(1, { message: '名称不能为空' })
  name: string;
}

export class UpdateEmployeeDictionaryDto {
  @ApiProperty({ example: '前厅', description: '名称' })
  @IsString({ message: '名称必须是字符串' })
  @MinLength(1, { message: '名称不能为空' })
  name: string;
}

export class EmployeeDepartmentResponseDto {
  @ApiProperty({ example: '1', description: '部门 ID' })
  @IsString({ message: '部门 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '前厅', description: '部门名称' })
  @IsString({ message: '部门名称必须是字符串' })
  name: string;

  @ApiProperty({ example: 1740009600000, description: '创建时间戳（毫秒）' })
  @IsInt({ message: '创建时间必须是整数时间戳' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1740096000000,
    description: '更新时间戳（毫秒）',
  })
  @IsOptional()
  @IsInt({ message: '更新时间必须是整数时间戳' })
  updatedAt?: number;
}

export class EmployeePositionResponseDto {
  @ApiProperty({ example: '1', description: '职位 ID' })
  @IsString({ message: '职位 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '服务员', description: '职位名称' })
  @IsString({ message: '职位名称必须是字符串' })
  name: string;

  @ApiProperty({ example: 1740009600000, description: '创建时间戳（毫秒）' })
  @IsInt({ message: '创建时间必须是整数时间戳' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1740096000000,
    description: '更新时间戳（毫秒）',
  })
  @IsOptional()
  @IsInt({ message: '更新时间必须是整数时间戳' })
  updatedAt?: number;
}
