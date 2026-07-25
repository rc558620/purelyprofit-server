import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScanOrderingSpecSelectionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** 新增商品规格组请求。 */
export class CreateScanOrderingSpecGroupDto {
  @ApiProperty({ example: '辣度', description: '规格组名称' })
  @IsString({ message: '规格组名称必须是字符串' })
  @MinLength(1, { message: '规格组名称不能为空' })
  @MaxLength(50, { message: '规格组名称不能超过 50 个字符' })
  name: string;

  @ApiPropertyOptional({
    enum: ScanOrderingSpecSelectionType,
    example: ScanOrderingSpecSelectionType.single,
  })
  @IsOptional()
  @IsEnum(ScanOrderingSpecSelectionType, { message: '规格选择类型不合法' })
  selectionType?: ScanOrderingSpecSelectionType;
}

/** 新增规格项请求，金额统一按元输入。 */
export class CreateScanOrderingSpecOptionDto {
  @ApiProperty({ example: '加辣', description: '规格项名称' })
  @IsString({ message: '规格项名称必须是字符串' })
  @MinLength(1, { message: '规格项名称不能为空' })
  @MaxLength(50, { message: '规格项名称不能超过 50 个字符' })
  name: string;

  @ApiPropertyOptional({ example: 2, description: '规格加价，单位元' })
  @IsOptional()
  @Type(() => Number)
  @Min(0, { message: '规格加价不能小于 0' })
  extraPrice?: number;

  @ApiPropertyOptional({ example: 20, description: '规格项库存' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '规格项库存必须是整数' })
  @Min(0, { message: '规格项库存不能小于 0' })
  stockQuantity?: number;
}
