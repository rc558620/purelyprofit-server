import { ApiPropertyOptional } from '@nestjs/swagger';
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

/** 更新扫码点餐菜单分类请求。 */
export class UpdateScanOrderingMenuCategoryDto {
  @ApiPropertyOptional({ example: '热菜' })
  @IsOptional()
  @IsString({ message: '菜单分类名称必须是字符串' })
  @MinLength(1, { message: '菜单分类名称不能为空' })
  @MaxLength(50, { message: '菜单分类名称不能超过 50 个字符' })
  name?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '分类排序值必须是整数' })
  @Min(0, { message: '分类排序值不能小于 0' })
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean({ message: '分类启用状态必须是布尔值' })
  isActive?: boolean;
}
