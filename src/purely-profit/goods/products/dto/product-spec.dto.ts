import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ProductSpecOptionDto {
  @ApiPropertyOptional({
    example: '12',
    description: '规格选项 ID（编辑已有选项时传入）',
  })
  @IsOptional()
  @IsString({ message: '规格选项 ID 必须是字符串' })
  id?: string;

  @ApiProperty({ example: '大杯', description: '规格选项名称' })
  @IsString({ message: '规格选项名称必须是字符串' })
  @MinLength(1, { message: '规格选项名称不能为空' })
  @MaxLength(50, { message: '规格选项名称最长 50 个字符' })
  name: string;

  @ApiProperty({ example: 2, description: '相对基础售价的加价金额（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '规格加价必须是数字' })
  priceDelta: number;

  @ApiProperty({ example: false, description: '是否默认选中' })
  @IsBoolean({ message: 'isDefault 必须是布尔值' })
  isDefault: boolean;

  @ApiProperty({ example: true, description: '是否启用' })
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive: boolean;
}

export class ProductSpecGroupDto {
  @ApiPropertyOptional({
    example: '8',
    description: '规格组 ID（编辑已有规格组时传入）',
  })
  @IsOptional()
  @IsString({ message: '规格组 ID 必须是字符串' })
  id?: string;

  @ApiProperty({ example: '杯型', description: '规格组名称' })
  @IsString({ message: '规格组名称必须是字符串' })
  @MinLength(1, { message: '规格组名称不能为空' })
  @MaxLength(50, { message: '规格组名称最长 50 个字符' })
  name: string;

  @ApiProperty({
    enum: ['single', 'multi'],
    example: 'single',
    description: '选择模式',
  })
  @IsIn(['single', 'multi'], { message: '选择模式必须是 single 或 multi' })
  selectMode: 'single' | 'multi';

  @ApiProperty({ example: 1, description: '最少选择数量；0 表示可跳过' })
  @IsInt({ message: '最少选择数量必须是整数' })
  @Min(0, { message: '最少选择数量不能小于 0' })
  minSelect: number;

  @ApiPropertyOptional({
    example: 1,
    description: '最多选择数量；null 表示不限制',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    value === null ? null : Number(value),
  )
  @IsInt({ message: '最多选择数量必须是整数' })
  @Min(1, { message: '最多选择数量不能小于 1' })
  maxSelect: number | null;

  @ApiProperty({ example: 0, description: '排序值' })
  @IsInt({ message: '排序值必须是整数' })
  @Min(0, { message: '排序值不能小于 0' })
  sort: number;

  @ApiProperty({ type: [ProductSpecOptionDto], description: '规格选项' })
  @IsArray({ message: '规格选项必须是数组' })
  @ArrayMaxSize(20, { message: '每个规格组最多 20 个选项' })
  @ValidateNested({ each: true })
  @Type(() => ProductSpecOptionDto)
  options: ProductSpecOptionDto[];
}
