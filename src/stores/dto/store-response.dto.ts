import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TransformFnParams } from 'class-transformer';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export type StoreRegionValue = string | number;

export interface StoreProfileMetadata {
  storeType: string;
  region: StoreRegionValue[];
  storeLogo?: string;
}

export interface StoreRecordSnapshot {
  id: number;
  name: string;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function transformOptionalInt({
  value,
}: TransformFnParams): number | string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? value : parsed;
  }

  if (typeof value === 'number') {
    return value;
  }

  return String(value);
}

export function transformOptionalKeyword({
  value,
}: TransformFnParams): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === '' ? undefined : trimmedValue;
}

export function normalizeStoreProfileMetadata(
  value: unknown,
): StoreProfileMetadata {
  if (!value || typeof value !== 'object') {
    return {
      storeType: '',
      region: [],
    };
  }

  const candidate = value as Partial<{
    storeType: unknown;
    region: unknown;
    storeLogo: unknown;
  }>;

  const region = Array.isArray(candidate.region)
    ? candidate.region.filter(
        (item): item is StoreRegionValue =>
          typeof item === 'string' || typeof item === 'number',
      )
    : [];

  const storeType =
    typeof candidate.storeType === 'string' ? candidate.storeType.trim() : '';
  const storeLogo =
    typeof candidate.storeLogo === 'string' && candidate.storeLogo.trim() !== ''
      ? candidate.storeLogo
      : undefined;

  return {
    storeType,
    region,
    ...(storeLogo ? { storeLogo } : {}),
  };
}

export function buildStoreResponseDto(
  store: StoreRecordSnapshot,
  metadata: StoreProfileMetadata,
): StoreResponseDto {
  return {
    id: store.id,
    storeName: store.name,
    storeType: metadata.storeType,
    region: metadata.region,
    address: store.address ?? '',
    ...(metadata.storeLogo ? { storeLogo: metadata.storeLogo } : {}),
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

export class PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '页码，从 1 开始' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于等于 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: '每页数量' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '每页数量必须是整数' })
  @Min(1, { message: '每页数量必须大于等于 1' })
  pageSize?: number;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1, description: '当前页码' })
  @IsInt({ message: '当前页码必须是整数' })
  page: number;

  @ApiProperty({ example: 20, description: '当前页大小' })
  @IsInt({ message: '当前页大小必须是整数' })
  pageSize: number;

  @ApiProperty({ example: 68, description: '总记录数' })
  @IsInt({ message: '总记录数必须是整数' })
  total: number;

  @ApiProperty({ example: 4, description: '总页数' })
  @IsInt({ message: '总页数必须是整数' })
  totalPages: number;
}

export class StoreResponseDto {
  @ApiProperty({ example: 1, description: '门店 ID' })
  @IsInt({ message: '门店 ID 必须是整数' })
  id: number;

  @ApiProperty({ example: '纯利优选示范店', description: '门店名称' })
  @IsString({ message: '门店名称必须是字符串' })
  storeName: string;

  @ApiProperty({ example: '零售', description: '门店类型' })
  @IsString({ message: '门店类型必须是字符串' })
  storeType: string;

  @ApiProperty({
    example: ['北京市', '北京市', '朝阳区'],
    description: '省市区',
  })
  @IsArray({ message: '省市区必须是数组' })
  region: StoreRegionValue[];

  @ApiProperty({
    example: '北京市朝阳区望京街道 1 号',
    description: '详细地址',
  })
  @IsString({ message: '门店地址必须是字符串' })
  address: string;

  @ApiPropertyOptional({
    example: 'data:image/png;base64,...',
    description: '门店 Logo',
  })
  @IsOptional()
  @IsString({ message: '门店 Logo 必须是字符串' })
  storeLogo?: string;

  @ApiProperty({
    example: '2026-05-12T10:00:00.000Z',
    description: '创建时间',
  })
  @IsDate({ message: '创建时间必须是日期' })
  createdAt: Date;

  @ApiProperty({
    example: '2026-05-12T10:00:00.000Z',
    description: '更新时间',
  })
  @IsDate({ message: '更新时间必须是日期' })
  updatedAt: Date;
}
