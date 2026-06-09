import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ClubStoreSummaryDto {
  @ApiProperty({ example: 1, description: '门店 ID' })
  @IsInt({ message: '门店 ID 必须是整数' })
  id: number;

  @ApiProperty({ example: 'purelyClub · 望京旗舰店', description: '门店名称' })
  @IsString({ message: '门店名称必须是字符串' })
  name: string;

  @ApiProperty({
    example: '北京市朝阳区望京 SOHO T3 B1',
    description: '门店地址',
  })
  @IsString({ message: '门店地址必须是字符串' })
  address: string;

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

  @ApiPropertyOptional({
    example: true,
    description: '门店营业状态；当前阶段未配置时不返回',
  })
  @IsOptional()
  @IsBoolean({ message: '门店营业状态必须是布尔值' })
  isOpen?: boolean;
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
