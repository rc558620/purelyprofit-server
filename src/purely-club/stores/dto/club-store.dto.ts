import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ClubStoreSummaryDto {
  @ApiProperty({ example: 1, description: '门店 ID' })
  @IsInt({ message: '门店 ID 必须是整数' })
  id: number;

  @ApiProperty({ example: 'purelyClub · 望京旗舰店', description: '门店名称' })
  @IsString({ message: '门店名称必须是字符串' })
  name: string;

  @ApiPropertyOptional({
    example: '北京市朝阳区望京 SOHO T3 B1',
    nullable: true,
    description: '门店地址；未配置时返回空字符串',
  })
  @IsString({ message: '门店地址必须是字符串' })
  address: string;

  @ApiProperty({
    enum: ['catering', 'general'],
    description: '门店业态：catering=餐饮，general=非餐饮',
  })
  @IsString({ message: '门店业态必须是字符串' })
  businessMode: 'catering' | 'general';

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/stores/store-cover.png',
    description: '门店封面图',
  })
  @IsOptional()
  @IsString({ message: '门店封面图必须是字符串' })
  coverImage?: string;

  @ApiPropertyOptional({
    example: '10:00 - 22:00',
    description: '门店营业时间；当前阶段未配置时不返回',
  })
  @IsOptional()
  @IsString({ message: '门店营业时间必须是字符串' })
  businessHours?: string;

  @ApiProperty({
    example: true,
    description:
      '门店营业状态；当前阶段默认返回 true（营业中），后续接入营业时间后动态计算',
  })
  @IsBoolean({ message: '门店营业状态必须是布尔值' })
  isOpen: boolean;

  @ApiPropertyOptional({
    example: 39.984104,
    description: '门店纬度，供 purely-club 首页腾讯地图定位使用',
  })
  @IsOptional()
  @IsNumber({}, { message: '门店纬度必须是数字' })
  @Min(-90, { message: '门店纬度不能小于 -90' })
  @Max(90, { message: '门店纬度不能大于 90' })
  latitude?: number;

  @ApiPropertyOptional({
    example: 116.307503,
    description: '门店经度，供 purely-club 首页腾讯地图定位使用',
  })
  @IsOptional()
  @IsNumber({}, { message: '门店经度必须是数字' })
  @Min(-180, { message: '门店经度不能小于 -180' })
  @Max(180, { message: '门店经度不能大于 180' })
  longitude?: number;
}

export class ClubStoresResponseDto {
  @ApiProperty({
    type: [ClubStoreSummaryDto],
    description: '当前用户可访问的门店列表',
  })
  @ValidateNested({ each: true })
  @Type(() => ClubStoreSummaryDto)
  items: ClubStoreSummaryDto[];

  @ApiPropertyOptional({
    example: 1,
    nullable: true,
    description: '当前选中的门店 ID；无可访问门店时为 null',
  })
  @IsOptional()
  @IsInt({ message: '当前门店 ID 必须是整数' })
  currentStoreId: number | null;
}

export class ClubSwitchCurrentStoreDto {
  @ApiProperty({ example: 1, description: '目标门店 ID' })
  @IsInt({ message: '目标门店 ID 必须是整数' })
  storeId: number;
}

export class ClubJoinStoreByInviteCodeDto {
  @ApiProperty({ example: 'SHOP2024', description: '门店邀请码' })
  @IsString({ message: '门店邀请码必须是字符串' })
  @IsNotEmpty({ message: '门店邀请码不能为空' })
  inviteCode: string;
}

export class ClubJoinStoreByScanDto {
  @ApiProperty({
    example:
      'https://club.purelyprofit.local/pages/storeSelect/index?inviteCode=ABCD23',
    description: '扫码得到的原始内容，支持门店邀请码、二维码 URL 或门店 ID',
  })
  @IsString({ message: '扫码内容必须是字符串' })
  @IsNotEmpty({ message: '扫码内容不能为空' })
  scanCode: string;
}

export class ClubSwitchCurrentStoreResponseDto {
  @ApiProperty({ example: true, description: '切换是否成功' })
  @IsBoolean({ message: '切换结果必须是布尔值' })
  success: boolean;

  @ApiProperty({
    type: ClubStoreSummaryDto,
    description: '切换后的当前门店摘要',
  })
  @ValidateNested()
  @Type(() => ClubStoreSummaryDto)
  store: ClubStoreSummaryDto;
}
