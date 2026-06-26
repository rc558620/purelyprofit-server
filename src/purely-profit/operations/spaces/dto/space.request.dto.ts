import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import {
  SPACE_STATUS_VALUES,
  type SpaceStatusValue,
} from '../spaces.constants';

function transformOptionalNullableInt({
  value,
}: {
  value: unknown;
}): number | null | string | undefined {
  if (value === '') {
    return null;
  }

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? value : parsed;
  }

  if (typeof value === 'number') {
    return value;
  }

  return undefined;
}

export class CreateSpaceDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ example: 'A台', description: '空间名称' })
  @IsString({ message: '空间名称必须是字符串' })
  @MinLength(1, { message: '空间名称不能为空' })
  @MaxLength(20, { message: '空间名称最长 20 个字符' })
  name: string;

  @ApiProperty({ example: '餐桌', description: '空间类型名称' })
  @IsString({ message: '空间类型必须是字符串' })
  @MinLength(1, { message: '空间类型不能为空' })
  @MaxLength(20, { message: '空间类型最长 20 个字符' })
  type: string;

  @ApiPropertyOptional({ example: '1楼', description: '空间区域名称' })
  @IsOptional()
  @IsString({ message: '空间区域必须是字符串' })
  @MaxLength(20, { message: '空间区域最长 20 个字符' })
  zone?: string;

  @ApiPropertyOptional({ example: 4, description: '容纳人数' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '容纳人数必须是整数' })
  @Min(1, { message: '容纳人数必须大于等于 1' })
  @Max(999, { message: '容纳人数必须小于等于 999' })
  capacity?: number;

  @ApiProperty({ example: false, description: '是否开启脏房模式' })
  @IsBoolean({ message: '脏房模式标记必须是布尔值' })
  enableDirtyRoom: boolean;

  @ApiProperty({ example: false, description: '是否默认自动结账' })
  @IsBoolean({ message: '自动结账标记必须是布尔值' })
  autoCheckout: boolean;

  @ApiProperty({ example: 1, description: '显示顺序' })
  @Transform(transformOptionalInt)
  @IsInt({ message: '显示顺序必须是整数' })
  @Min(1, { message: '显示顺序必须大于等于 1' })
  sortOrder: number;
}

export class UpdateSpaceDto {
  @ApiPropertyOptional({ example: 'A台', description: '空间名称' })
  @IsOptional()
  @IsString({ message: '空间名称必须是字符串' })
  @MinLength(1, { message: '空间名称不能为空' })
  @MaxLength(20, { message: '空间名称最长 20 个字符' })
  name?: string;

  @ApiPropertyOptional({ example: '餐桌', description: '空间类型名称' })
  @IsOptional()
  @IsString({ message: '空间类型必须是字符串' })
  @MinLength(1, { message: '空间类型不能为空' })
  @MaxLength(20, { message: '空间类型最长 20 个字符' })
  type?: string;

  @ApiPropertyOptional({
    example: '1楼',
    description: '空间区域名称，空字符串表示清空',
  })
  @IsOptional()
  @IsString({ message: '空间区域必须是字符串' })
  @MaxLength(20, { message: '空间区域最长 20 个字符' })
  zone?: string;

  @ApiPropertyOptional({
    example: 4,
    description: '容纳人数，空字符串表示清空',
  })
  @IsOptional()
  @Transform(transformOptionalNullableInt)
  @IsInt({ message: '容纳人数必须是整数' })
  @Min(1, { message: '容纳人数必须大于等于 1' })
  @Max(999, { message: '容纳人数必须小于等于 999' })
  capacity?: number | null;

  @ApiPropertyOptional({ example: false, description: '是否开启脏房模式' })
  @IsOptional()
  @IsBoolean({ message: '脏房模式标记必须是布尔值' })
  enableDirtyRoom?: boolean;

  @ApiPropertyOptional({ example: false, description: '是否默认自动结账' })
  @IsOptional()
  @IsBoolean({ message: '自动结账标记必须是布尔值' })
  autoCheckout?: boolean;

  @ApiPropertyOptional({ example: 1, description: '显示顺序' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '显示顺序必须是整数' })
  @Min(1, { message: '显示顺序必须大于等于 1' })
  sortOrder?: number;
}

/**
 * @deprecated Space.status 已从 schema 移除，运行态由 session/reservation 推导。
 * 此 DTO 已废弃，对应接口 PATCH /spaces/:id/status 已返回 410 Gone。
 */
export class UpdateSpaceStatusDto {
  @ApiProperty({
    example: 'reserved',
    description: '空间状态',
    enum: SPACE_STATUS_VALUES,
  })
  @IsIn(SPACE_STATUS_VALUES, { message: '空间状态不合法' })
  status: SpaceStatusValue;
}
