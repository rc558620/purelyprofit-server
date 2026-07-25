import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** 新增扫码点餐区域请求。 */
export class CreateScanOrderingAreaDto {
  @ApiProperty({ example: '大厅', description: '区域名称' })
  @IsString({ message: '区域名称必须是字符串' })
  @MinLength(1, { message: '区域名称不能为空' })
  @MaxLength(50, { message: '区域名称不能超过 50 个字符' })
  name: string;

  @ApiPropertyOptional({ example: 10, description: '排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须是整数' })
  @Min(0, { message: '排序值不能小于 0' })
  sortOrder?: number;
}

/** 更新扫码点餐区域请求。 */
export class UpdateScanOrderingAreaDto {
  @ApiPropertyOptional({ example: '一楼大厅', description: '区域名称' })
  @IsOptional()
  @IsString({ message: '区域名称必须是字符串' })
  @MinLength(1, { message: '区域名称不能为空' })
  @MaxLength(50, { message: '区域名称不能超过 50 个字符' })
  name?: string;

  @ApiPropertyOptional({ example: 10, description: '排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '排序值必须是整数' })
  @Min(0, { message: '排序值不能小于 0' })
  sortOrder?: number;

  @ApiPropertyOptional({ example: true, description: '是否启用' })
  @IsOptional()
  @IsBoolean({ message: '启用状态必须是布尔值' })
  isActive?: boolean;
}
