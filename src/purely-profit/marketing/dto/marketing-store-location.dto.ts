import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * 营销中心「设置门店坐标」专用写 DTO。
 *
 * 刻意只收坐标与选点地址：门店名称、Logo、服务人员称呼、省市区等字段
 * 属于门店设置（主账号专属），店长只能改坐标，避免越权扩大。
 */
export class UpdateMarketingStoreLocationDto {
  @ApiProperty({
    example: 39.984104,
    description: '门店纬度，供腾讯地图定位使用',
  })
  @Type(() => Number)
  @IsNumber({}, { message: '门店纬度必须是数字' })
  @Min(-90, { message: '门店纬度不能小于 -90' })
  @Max(90, { message: '门店纬度不能大于 90' })
  latitude: number;

  @ApiProperty({
    example: 116.307503,
    description: '门店经度，供腾讯地图定位使用',
  })
  @Type(() => Number)
  @IsNumber({}, { message: '门店经度必须是数字' })
  @Min(-180, { message: '门店经度不能小于 -180' })
  @Max(180, { message: '门店经度不能大于 180' })
  longitude: number;

  @ApiPropertyOptional({
    example: '北京市朝阳区望京街道 1 号',
    description: '选点回填的详细地址（腾讯地图返回的名称或地址）',
  })
  @IsOptional()
  @IsString({ message: '门店地址必须是字符串' })
  @MinLength(1, { message: '详细地址不能为空' })
  @MaxLength(200, { message: '门店地址不能超过 200 个字符' })
  address?: string;
}
