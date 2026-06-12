import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

type StoreRegionValue = string | number;

export class CreateStoreDto {
  @ApiProperty({ example: '纯利优选示范店', description: '门店名称' })
  @IsString({ message: '门店名称必须是字符串' })
  @MinLength(2, { message: '门店名称至少 2 位' })
  storeName: string;

  @ApiProperty({ example: '零售', description: '门店类型' })
  @IsString({ message: '门店类型必须是字符串' })
  @MinLength(1, { message: '门店类型不能为空' })
  storeType: string;

  @ApiProperty({
    example: ['北京市', '北京市', '朝阳区'],
    description: '省市区数组',
  })
  @IsArray({ message: '省市区必须是数组' })
  @ArrayMinSize(3, { message: '请选择完整的省市区' })
  region: StoreRegionValue[];

  @ApiProperty({
    example: '北京市朝阳区望京街道 1 号',
    description: '详细地址',
  })
  @IsString({ message: '门店地址必须是字符串' })
  @MinLength(1, { message: '详细地址不能为空' })
  address: string;

  @ApiPropertyOptional({
    example: ['云南省', '昆明市', '五华区'],
    description: '省市区名称数组，兼容前端表单直传字段',
  })
  @IsOptional()
  @IsArray({ message: '省市区名称数组必须是数组' })
  @IsString({ each: true, message: '省市区名称项必须是字符串' })
  regionLabels?: string[];

  @ApiPropertyOptional({
    example: '530000',
    description: '省编码，兼容前端表单直传字段',
  })
  @IsOptional()
  @IsString({ message: '省编码必须是字符串' })
  provinceCode?: string;

  @ApiPropertyOptional({
    example: '云南省',
    description: '省名称，兼容前端表单直传字段',
  })
  @IsOptional()
  @IsString({ message: '省名称必须是字符串' })
  provinceName?: string;

  @ApiPropertyOptional({
    example: '530100',
    description: '市编码，兼容前端表单直传字段',
  })
  @IsOptional()
  @IsString({ message: '市编码必须是字符串' })
  cityCode?: string;

  @ApiPropertyOptional({
    example: '昆明市',
    description: '市名称，兼容前端表单直传字段',
  })
  @IsOptional()
  @IsString({ message: '市名称必须是字符串' })
  cityName?: string;

  @ApiPropertyOptional({
    example: '530102',
    description: '区编码，兼容前端表单直传字段',
  })
  @IsOptional()
  @IsString({ message: '区编码必须是字符串' })
  districtCode?: string;

  @ApiPropertyOptional({
    example: '五华区',
    description: '区名称，兼容前端表单直传字段',
  })
  @IsOptional()
  @IsString({ message: '区名称必须是字符串' })
  districtName?: string;

  @ApiPropertyOptional({
    example: 'data:image/png;base64,...',
    description: '门店 Logo',
  })
  @IsOptional()
  @IsString({ message: '门店 Logo 必须是字符串' })
  storeLogo?: string;

  @ApiPropertyOptional({
    example: 39.984104,
    description: '门店纬度，供腾讯地图定位使用',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '门店纬度必须是数字' })
  @Min(-90, { message: '门店纬度不能小于 -90' })
  @Max(90, { message: '门店纬度不能大于 90' })
  latitude?: number;

  @ApiPropertyOptional({
    example: 116.307503,
    description: '门店经度，供腾讯地图定位使用',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '门店经度必须是数字' })
  @Min(-180, { message: '门店经度不能小于 -180' })
  @Max(180, { message: '门店经度不能大于 180' })
  longitude?: number;
}
