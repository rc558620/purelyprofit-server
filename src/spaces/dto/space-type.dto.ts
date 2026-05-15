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
import { transformOptionalInt } from '../../stores/dto/store-response.dto';

export class ListSpaceTypesQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}

export class CreateSpaceTypeDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ example: '包间', description: '空间类型名称' })
  @IsString({ message: '空间类型名称必须是字符串' })
  @MinLength(1, { message: '空间类型名称不能为空' })
  @MaxLength(20, { message: '空间类型名称最长 20 个字符' })
  name: string;
}

export class UpdateSpaceTypeDto {
  @ApiProperty({ example: 'VIP 包间', description: '空间类型名称' })
  @IsString({ message: '空间类型名称必须是字符串' })
  @MinLength(1, { message: '空间类型名称不能为空' })
  @MaxLength(20, { message: '空间类型名称最长 20 个字符' })
  name: string;
}

export class SpaceTypeResponseDto {
  @ApiProperty({ example: '1', description: '空间类型 ID' })
  id: string;

  @ApiProperty({ example: '包间', description: '空间类型名称' })
  name: string;

  @ApiProperty({ example: 1715600000000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiProperty({ example: 1715603600000, description: '更新时间戳（毫秒）' })
  updatedAt: number;
}
