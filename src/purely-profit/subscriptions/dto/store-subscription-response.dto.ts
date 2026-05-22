import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionPlanCode, StoreSubscriptionStatus } from '@prisma/client';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SubscriptionSeatSummaryDto {
  @ApiProperty({ example: 3, description: '当前套餐可用账号席位上限' })
  @IsInt({ message: '账号席位上限必须是整数' })
  maxAccountSeats: number;

  @ApiProperty({ example: 2, description: '当前已激活并占用的账号数' })
  @IsInt({ message: '已激活账号数必须是整数' })
  activeSeatCount: number;

  @ApiProperty({ example: 1, description: '当前剩余可用账号席位数' })
  @IsInt({ message: '剩余可用账号席位数必须是整数' })
  availableSeatCount: number;
}

export class StoreSubscriptionResponseDto {
  @ApiProperty({ example: 1, description: '订阅 ID' })
  @IsInt({ message: '订阅 ID 必须是整数' })
  id: number;

  @ApiProperty({ example: 1, description: '所属门店 ID' })
  @IsInt({ message: '所属门店 ID 必须是整数' })
  storeId: number;

  @ApiProperty({ enum: SubscriptionPlanCode, description: '套餐编码' })
  @IsEnum(SubscriptionPlanCode, { message: '套餐编码不合法' })
  planCode: SubscriptionPlanCode;

  @ApiProperty({ example: '成长版', description: '套餐名称' })
  @IsString({ message: '套餐名称必须是字符串' })
  planName: string;

  @ApiProperty({ enum: StoreSubscriptionStatus, description: '订阅状态' })
  @IsEnum(StoreSubscriptionStatus, { message: '订阅状态不合法' })
  status: StoreSubscriptionStatus;

  @ApiProperty({ example: 2, description: '订阅生效后的门店账号席位上限' })
  @IsInt({ message: '订阅席位数必须是整数' })
  maxAccountSeats: number;

  @ApiProperty({
    example: '2026-05-13T10:00:00.000Z',
    description: '套餐开始时间',
  })
  @IsDate({ message: '套餐开始时间必须是日期' })
  startsAt: Date;

  @ApiPropertyOptional({
    example: '2026-06-13T10:00:00.000Z',
    description: '套餐到期时间',
  })
  @IsOptional()
  @IsDate({ message: '套餐到期时间必须是日期' })
  expiresAt: Date | null;

  @ApiProperty({
    type: SubscriptionSeatSummaryDto,
    description: '当前席位概览',
  })
  @ValidateNested()
  @Type(() => SubscriptionSeatSummaryDto)
  seatSummary: SubscriptionSeatSummaryDto;
}
