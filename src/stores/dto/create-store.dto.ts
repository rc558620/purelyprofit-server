import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
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
    example: 'data:image/png;base64,...',
    description: '门店 Logo',
  })
  @IsOptional()
  @IsString({ message: '门店 Logo 必须是字符串' })
  storeLogo?: string;
}
