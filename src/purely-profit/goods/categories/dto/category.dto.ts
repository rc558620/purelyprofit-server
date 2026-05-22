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
} from '../../../stores/dto/store-response.dto';

export class ListCategoriesQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({ example: '饮', description: '分类关键字' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '关键字必须是字符串' })
  keyword?: string;
}

export class CreateCategoryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ example: '饮品', description: '分类名称' })
  @IsString({ message: '分类名称必须是字符串' })
  @MinLength(1, { message: '分类名称不能为空' })
  @MaxLength(30, { message: '分类名称最长 30 个字符' })
  name: string;

  @ApiPropertyOptional({ example: '🥤', description: '分类图标' })
  @IsOptional()
  @IsString({ message: '分类图标必须是字符串' })
  @MaxLength(50, { message: '分类图标最长 50 个字符' })
  icon?: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: '饮品', description: '分类名称' })
  @IsOptional()
  @IsString({ message: '分类名称必须是字符串' })
  @MinLength(1, { message: '分类名称不能为空' })
  @MaxLength(30, { message: '分类名称最长 30 个字符' })
  name?: string;

  @ApiPropertyOptional({
    example: '🥤',
    description: '分类图标，空字符串表示清空',
  })
  @IsOptional()
  @IsString({ message: '分类图标必须是字符串' })
  @MaxLength(50, { message: '分类图标最长 50 个字符' })
  icon?: string;
}

export class CategoryResponseDto {
  @ApiProperty({ example: '1', description: '分类 ID' })
  id: string;

  @ApiProperty({ example: '饮品', description: '分类名称' })
  name: string;

  @ApiPropertyOptional({ example: '🥤', description: '分类图标' })
  icon?: string;

  @ApiProperty({ example: 1715600000000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiProperty({ example: 1715603600000, description: '更新时间戳（毫秒）' })
  updatedAt: number;
}
