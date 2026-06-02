import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import {
  PLATFORM_POINTS_RECORD_SOURCES,
  PLATFORM_POINTS_RECORD_TYPES,
  PlatformMembershipInfoDto,
} from './platform-membership-shared.response.dto';

export class PlatformMembershipPointsOverviewDto {
  @ApiProperty({ example: 1280, description: '可用积分' })
  @IsInt({ message: '可用积分必须是整数' })
  availablePoints: number;

  @ApiProperty({ example: 1800, description: '累计获得积分' })
  @IsInt({ message: '累计获得积分必须是整数' })
  totalEarned: number;

  @ApiProperty({ example: 520, description: '累计使用/扣减积分' })
  @IsInt({ message: '累计使用积分必须是整数' })
  totalSpent: number;
}

export class PlatformMembershipPointsLogDto {
  @ApiProperty({ example: 'pts-11', description: '积分记录 ID' })
  @IsString({ message: '积分记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    example: 300,
    description: '积分变动值，正数=获得，负数=使用/过期',
  })
  @IsInt({ message: '积分变动值必须是整数' })
  amount: number;

  @ApiProperty({
    enum: PLATFORM_POINTS_RECORD_TYPES,
    example: 'earn',
    description: '积分变动类型',
  })
  @IsString({ message: '积分变动类型必须是字符串' })
  type: (typeof PLATFORM_POINTS_RECORD_TYPES)[number];

  @ApiProperty({
    enum: PLATFORM_POINTS_RECORD_SOURCES,
    example: 'purchase_bonus',
    description: '积分来源',
  })
  @IsString({ message: '积分来源必须是字符串' })
  source: (typeof PLATFORM_POINTS_RECORD_SOURCES)[number];

  @ApiProperty({ example: '购买季度会员赠积分', description: '来源描述' })
  @IsString({ message: '来源描述必须是字符串' })
  description: string;

  @ApiProperty({ example: 1747123200000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1749724800000,
    description: '积分到期时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '到期时间必须是整数' })
  expireAt?: number;
}

export class PlatformMembershipPointsLogsResponseDto {
  @ApiProperty({ type: PlatformMembershipInfoDto, description: '当前会员信息' })
  @ValidateNested()
  @Type(() => PlatformMembershipInfoDto)
  memberInfo: PlatformMembershipInfoDto;

  @ApiProperty({
    type: PlatformMembershipPointsOverviewDto,
    description: '积分中心汇总信息',
  })
  @ValidateNested()
  @Type(() => PlatformMembershipPointsOverviewDto)
  overview: PlatformMembershipPointsOverviewDto;

  @ApiProperty({
    type: [PlatformMembershipPointsLogDto],
    description: '积分记录列表，按创建时间倒序',
  })
  @IsArray({ message: '积分记录列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PlatformMembershipPointsLogDto)
  items: PlatformMembershipPointsLogDto[];
}
