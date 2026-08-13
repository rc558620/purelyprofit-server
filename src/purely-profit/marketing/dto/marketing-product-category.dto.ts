import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import {
  MARKETING_PRODUCT_IMAGE_MAX_LENGTH,
  trimString,
} from './marketing-product-transforms';

/**
 * 创建营销产品分类参数
 */
export class CreateMarketingProductCategoryDto {
  @ApiProperty({ example: '推拿按摩', description: '分类名称' })
  @IsString({ message: '分类名称必须是字符串' })
  @Transform(trimString)
  @MinLength(1, { message: '分类名称不能为空' })
  @MaxLength(20, { message: '分类名称最长 20 个字符' })
  name: string;

  @ApiPropertyOptional({
    example: '💆',
    description: '分类图标（emoji 或图片 URL）',
  })
  @IsOptional()
  @IsString({ message: '分类图标必须是字符串' })
  @MaxLength(MARKETING_PRODUCT_IMAGE_MAX_LENGTH, {
    message: `分类图标最长 ${MARKETING_PRODUCT_IMAGE_MAX_LENGTH} 个字符`,
  })
  icon?: string;
}

/**
 * 更新营销产品分类参数
 */
export class UpdateMarketingProductCategoryDto {
  @ApiPropertyOptional({ example: '推拿按摩', description: '分类名称' })
  @IsOptional()
  @IsString({ message: '分类名称必须是字符串' })
  @Transform(trimString)
  @MinLength(1, { message: '分类名称不能为空' })
  @MaxLength(20, { message: '分类名称最长 20 个字符' })
  name?: string;

  @ApiPropertyOptional({
    example: '💆',
    description: '分类图标（空字符串表示清空）',
  })
  @IsOptional()
  @IsString({ message: '分类图标必须是字符串' })
  @MaxLength(MARKETING_PRODUCT_IMAGE_MAX_LENGTH, {
    message: `分类图标最长 ${MARKETING_PRODUCT_IMAGE_MAX_LENGTH} 个字符`,
  })
  icon?: string;
}
