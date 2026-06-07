import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import {
  PaginationQueryDto,
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../../stores/dto/store-response.dto';

export const ADJUSTMENT_DIRECTION_VALUES = [
  'add',
  'subtract',
  'deduct',
  'reduce',
] as const;

export type AdjustmentDirectionValue =
  (typeof ADJUSTMENT_DIRECTION_VALUES)[number];

export class MemberAssetLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '按门店 ID 筛选' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    example: '刘梅',
    description: '按会员姓名、手机号或说明搜索',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '搜索关键词必须是字符串' })
  keyword?: string;
}

export class MemberAssetIdentityDto {
  @ApiPropertyOptional({ example: '1', description: '会员 ID' })
  @IsOptional()
  @IsString({ message: '会员 ID 必须是字符串' })
  userId?: string;

  @ApiPropertyOptional({
    example: '1',
    description: '兼容旧请求的会员 ID 字段',
  })
  @IsOptional()
  @IsString({ message: '会员 ID 必须是字符串' })
  memberId?: string;

  @ApiPropertyOptional({
    example: '1',
    description: '兼容旧请求的主键 ID 字段',
  })
  @IsOptional()
  @IsString({ message: '会员 ID 必须是字符串' })
  id?: string;
}

export class MemberLogsOverviewQueryDto {
  @ApiPropertyOptional({ example: 1, description: '按门店 ID 获取记录概览' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}
