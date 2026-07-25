import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** 新增扫码点餐桌台请求。 */
export class CreateScanOrderingTableDto {
  @ApiProperty({ example: 'A01', description: '桌台业务编号' })
  @IsString({ message: '桌台编号必须是字符串' })
  @MinLength(1, { message: '桌台编号不能为空' })
  @MaxLength(32, { message: '桌台编号不能超过 32 个字符' })
  tableCode: string;

  @ApiProperty({ example: 'A01 卡座', description: '桌台展示名称' })
  @IsString({ message: '桌台名称必须是字符串' })
  @MinLength(1, { message: '桌台名称不能为空' })
  @MaxLength(50, { message: '桌台名称不能超过 50 个字符' })
  name: string;

  @ApiPropertyOptional({ example: 4, description: '桌台容纳人数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '桌台容量必须是整数' })
  @Min(1, { message: '桌台容量至少为 1 人' })
  @Max(100, { message: '桌台容量不能超过 100 人' })
  capacity?: number;

  @ApiPropertyOptional({ example: 1, description: '所属区域 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '区域 ID 必须是整数' })
  @Min(1, { message: '区域 ID 至少为 1' })
  areaId?: number;

  @ApiPropertyOptional({ example: 1, description: '桌台类型 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '类型 ID 必须是整数' })
  @Min(1, { message: '类型 ID 至少为 1' })
  typeId?: number;
}

/** 更新扫码点餐桌台请求。 */
export class UpdateScanOrderingTableDto {
  @ApiPropertyOptional({ example: 'A01 靠窗卡座', description: '桌台展示名称' })
  @IsOptional()
  @IsString({ message: '桌台名称必须是字符串' })
  @MinLength(1, { message: '桌台名称不能为空' })
  @MaxLength(50, { message: '桌台名称不能超过 50 个字符' })
  name?: string;

  @ApiPropertyOptional({ example: 4, description: '桌台容纳人数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '桌台容量必须是整数' })
  @Min(1, { message: '桌台容量至少为 1 人' })
  @Max(100, { message: '桌台容量不能超过 100 人' })
  capacity?: number;

  @ApiPropertyOptional({ example: false, description: '是否启用桌台' })
  @IsOptional()
  @IsBoolean({ message: '桌台启用状态必须是布尔值' })
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1, description: '所属区域 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '区域 ID 必须是整数' })
  @Min(1, { message: '区域 ID 至少为 1' })
  areaId?: number;

  @ApiPropertyOptional({ example: 1, description: '桌台类型 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '类型 ID 必须是整数' })
  @Min(1, { message: '类型 ID 至少为 1' })
  typeId?: number;
}
