import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SpaceSessionItemDto {
  @ApiProperty({ example: 'prod_1001', description: '商品 ID' })
  @IsString({ message: '商品 ID 必须是字符串' })
  @MaxLength(64, { message: '商品 ID 最长 64 个字符' })
  productId: string;

  @ApiProperty({ example: '可乐', description: '商品名称' })
  @IsString({ message: '商品名称必须是字符串' })
  @MaxLength(100, { message: '商品名称最长 100 个字符' })
  productName: string;

  @ApiProperty({ example: '饮品', description: '商品分类' })
  @IsString({ message: '商品分类必须是字符串' })
  @MaxLength(100, { message: '商品分类最长 100 个字符' })
  categoryName: string;

  @ApiProperty({ example: 12, description: '销售单价（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '销售单价必须是数字' })
  @Min(0, { message: '销售单价不能小于 0' })
  salePrice: number;

  @ApiProperty({ example: 6, description: '单件利润（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '单件利润必须是数字' })
  profit: number;

  @ApiProperty({ example: 2, description: '数量' })
  @Type(() => Number)
  @IsInt({ message: '数量必须是整数' })
  @Min(1, { message: '数量必须大于等于 1' })
  quantity: number;
}

export class AddSpaceSessionItemsDto {
  @ApiProperty({
    type: [SpaceSessionItemDto],
    description: '本次追加的商品明细',
  })
  @IsArray({ message: '商品明细必须是数组' })
  @ArrayMinSize(1, { message: '请至少选择一件商品' })
  @ValidateNested({ each: true })
  @Type(() => SpaceSessionItemDto)
  items: SpaceSessionItemDto[];

  @ApiProperty({
    enum: ['client', 'server'],
    default: 'client',
    description: '库存同步模式：client=前端同步（旧模式），server=后端同步（新模式）',
  })
  @IsOptional()
  @IsIn(['client', 'server'], { message: '库存同步模式只能是 client 或 server' })
  inventorySyncMode?: 'client' | 'server';
}
