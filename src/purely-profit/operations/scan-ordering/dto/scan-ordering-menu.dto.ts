import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScanOrderingStockMode } from '@prisma/client';
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

/** 新增扫码点餐菜单分类请求。 */
export class CreateScanOrderingMenuCategoryDto {
  @ApiProperty({ example: '主食', description: '菜单分类名称' })
  @IsString({ message: '菜单分类名称必须是字符串' })
  @MinLength(1, { message: '菜单分类名称不能为空' })
  @MaxLength(50, { message: '菜单分类名称不能超过 50 个字符' })
  name: string;

  @ApiPropertyOptional({ example: 10, description: '分类排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '分类排序值必须是整数' })
  @Min(0, { message: '分类排序值不能小于 0' })
  sortOrder?: number;
}

/** 新增扫码点餐商品请求，金额统一按元输入并由后端转换。 */
export class CreateScanOrderingMenuProductDto {
  @ApiProperty({ example: 1, description: '扫码点餐菜单分类主键' })
  @Type(() => Number)
  @IsInt({ message: '菜单分类必须是整数' })
  @Min(1, { message: '菜单分类不合法' })
  categoryId: number;

  @ApiProperty({ example: '招牌牛肉面', description: '商品名称' })
  @IsString({ message: '商品名称必须是字符串' })
  @MinLength(1, { message: '商品名称不能为空' })
  @MaxLength(100, { message: '商品名称不能超过 100 个字符' })
  name: string;

  @ApiProperty({ example: 28, description: '商品售价，单位元' })
  @Type(() => Number)
  @Min(0, { message: '商品售价不能小于 0' })
  basePrice: number;

  @ApiPropertyOptional({
    enum: ScanOrderingStockMode,
    example: ScanOrderingStockMode.unlimited,
  })
  @IsOptional()
  @IsEnum(ScanOrderingStockMode, { message: '库存模式不合法' })
  stockMode?: ScanOrderingStockMode;

  @ApiPropertyOptional({ example: 20, description: '有限库存时的可售数量' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '库存数量必须是整数' })
  @Min(0, { message: '库存数量不能小于 0' })
  stockQuantity?: number;
}

/** 更新扫码点餐商品可售状态请求。 */
export class UpdateScanOrderingMenuProductAvailabilityDto {
  @ApiProperty({ example: true, description: '商品是否上架' })
  @IsBoolean({ message: '商品上架状态必须是布尔值' })
  isActive: boolean;
}
