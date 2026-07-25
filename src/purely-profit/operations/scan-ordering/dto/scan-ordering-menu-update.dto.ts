import { ApiPropertyOptional } from '@nestjs/swagger';
import { ScanOrderingSpecSelectionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** 更新扫码点餐商品请求。 */
export class UpdateScanOrderingMenuProductDto {
  @ApiPropertyOptional({ example: '招牌牛肉面' })
  @IsOptional()
  @IsString({ message: '商品名称必须是字符串' })
  @MinLength(1, { message: '商品名称不能为空' })
  @MaxLength(100, { message: '商品名称不能超过 100 个字符' })
  name?: string;

  @ApiPropertyOptional({ example: 30, description: '商品售价，单位元' })
  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: '商品售价不能小于 0' })
  basePrice?: number;
}

/** 更新规格组请求。 */
export class UpdateScanOrderingSpecGroupDto {
  @ApiPropertyOptional({ example: '辣度' })
  @IsOptional()
  @IsString({ message: '规格组名称必须是字符串' })
  @MinLength(1, { message: '规格组名称不能为空' })
  @MaxLength(50, { message: '规格组名称不能超过 50 个字符' })
  name?: string;

  @ApiPropertyOptional({ enum: ScanOrderingSpecSelectionType })
  @IsOptional()
  @IsEnum(ScanOrderingSpecSelectionType, { message: '规格选择类型不合法' })
  selectionType?: ScanOrderingSpecSelectionType;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean({ message: '规格组启用状态必须是布尔值' })
  isActive?: boolean;
}

/** 更新规格项请求。 */
export class UpdateScanOrderingSpecOptionDto {
  @ApiPropertyOptional({ example: '加辣' })
  @IsOptional()
  @IsString({ message: '规格项名称必须是字符串' })
  @MinLength(1, { message: '规格项名称不能为空' })
  @MaxLength(50, { message: '规格项名称不能超过 50 个字符' })
  name?: string;

  @ApiPropertyOptional({ example: 2, description: '规格加价，单位元' })
  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: '规格加价不能小于 0' })
  extraPrice?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean({ message: '规格项启用状态必须是布尔值' })
  isActive?: boolean;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '规格项库存必须是整数' })
  @Min(0, { message: '规格项库存不能小于 0' })
  stockQuantity?: number;
}
