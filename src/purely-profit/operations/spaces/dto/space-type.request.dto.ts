import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';

/**
 * 名称只接受字符串原值，不做隐式转换。
 *
 * 全局管道开启了 enableImplicitConversion，若直接读 `value`，{ name: 123 }
 * 会被转成 "123"、{ name: {} } 会被转成 "[object Object]" 并通过 @IsString。
 * 这里回读原始请求值，非字符串原样返回，交给 @IsString 拒绝。
 */
const transformRawSpaceTypeName = ({
  obj,
  key,
}: TransformFnParams): unknown => {
  const raw = (obj as Record<string, unknown> | null | undefined)?.[key];
  return typeof raw === 'string' ? raw.trim() : raw;
};

export class CreateSpaceTypeDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({ example: '包间', description: '空间类型名称' })
  @Transform(transformRawSpaceTypeName)
  @IsString({ message: '空间类型名称必须是字符串' })
  @MinLength(1, { message: '空间类型名称不能为空' })
  @MaxLength(20, { message: '空间类型名称最长 20 个字符' })
  name: string;
}

export class UpdateSpaceTypeDto {
  @ApiProperty({ example: 'VIP 包间', description: '空间类型名称' })
  @Transform(transformRawSpaceTypeName)
  @IsString({ message: '空间类型名称必须是字符串' })
  @MinLength(1, { message: '空间类型名称不能为空' })
  @MaxLength(20, { message: '空间类型名称最长 20 个字符' })
  name: string;
}
