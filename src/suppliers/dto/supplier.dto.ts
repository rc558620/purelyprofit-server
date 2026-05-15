import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../stores/dto/store-response.dto';

export class ListSuppliersQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({ example: '张老板', description: '供应商关键字' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '关键字必须是字符串' })
  keyword?: string;
}

export class CreateSupplierDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ example: '张老板批发', description: '供应商名称' })
  @IsString({ message: '供应商名称必须是字符串' })
  @MinLength(1, { message: '供应商名称不能为空' })
  @MaxLength(30, { message: '供应商名称最长 30 个字符' })
  name: string;

  @ApiPropertyOptional({ example: '张老板', description: '联系人' })
  @IsOptional()
  @IsString({ message: '联系人必须是字符串' })
  @MaxLength(20, { message: '联系人最长 20 个字符' })
  contact?: string;

  @ApiPropertyOptional({ example: '13800138000', description: '联系电话' })
  @IsOptional()
  @IsString({ message: '联系电话必须是字符串' })
  @MaxLength(20, { message: '联系电话最长 20 个字符' })
  phone?: string;

  @ApiPropertyOptional({ example: '饮品', description: '主营品类' })
  @IsOptional()
  @IsString({ message: '主营品类必须是字符串' })
  @MaxLength(20, { message: '主营品类最长 20 个字符' })
  category?: string;

  @ApiPropertyOptional({ example: '每周三送货', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional({ example: '张老板批发', description: '供应商名称' })
  @IsOptional()
  @IsString({ message: '供应商名称必须是字符串' })
  @MinLength(1, { message: '供应商名称不能为空' })
  @MaxLength(30, { message: '供应商名称最长 30 个字符' })
  name?: string;

  @ApiPropertyOptional({
    example: '张老板',
    description: '联系人，空字符串表示清空',
  })
  @IsOptional()
  @IsString({ message: '联系人必须是字符串' })
  @MaxLength(20, { message: '联系人最长 20 个字符' })
  contact?: string;

  @ApiPropertyOptional({
    example: '13800138000',
    description: '联系电话，空字符串表示清空',
  })
  @IsOptional()
  @IsString({ message: '联系电话必须是字符串' })
  @MaxLength(20, { message: '联系电话最长 20 个字符' })
  phone?: string;

  @ApiPropertyOptional({
    example: '饮品',
    description: '主营品类，空字符串表示清空',
  })
  @IsOptional()
  @IsString({ message: '主营品类必须是字符串' })
  @MaxLength(20, { message: '主营品类最长 20 个字符' })
  category?: string;

  @ApiPropertyOptional({
    example: '每周三送货',
    description: '备注，空字符串表示清空',
  })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;
}

export class SupplierResponseDto {
  @ApiProperty({ example: '1', description: '供应商 ID' })
  id: string;

  @ApiProperty({ example: '张老板批发', description: '供应商名称' })
  name: string;

  @ApiPropertyOptional({ example: '张老板', description: '联系人' })
  contact?: string;

  @ApiPropertyOptional({ example: '13800138000', description: '联系电话' })
  phone?: string;

  @ApiPropertyOptional({ example: '饮品', description: '主营品类' })
  category?: string;

  @ApiPropertyOptional({ example: '每周三送货', description: '备注' })
  note?: string;

  @ApiProperty({ example: 1715600000000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiProperty({ example: 1715603600000, description: '更新时间戳（毫秒）' })
  updatedAt: number;
}
