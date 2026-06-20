import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionPlanCode, StoreSubscriptionStatus } from '@prisma/client';

export class SubscriptionSeatSummaryDto {
  @ApiProperty({ example: 3, description: '当前套餐可用账号席位上限' })
  maxAccountSeats: number;

  @ApiProperty({ example: 2, description: '当前已激活并占用的账号数' })
  activeSeatCount: number;

  @ApiProperty({ example: 1, description: '当前剩余可用账号席位数' })
  availableSeatCount: number;
}

export class StoreSubscriptionResponseDto {
  @ApiProperty({ example: 1, description: '订阅 ID' })
  id: number;

  @ApiProperty({ example: 1, description: '所属门店 ID' })
  storeId: number;

  @ApiProperty({ enum: SubscriptionPlanCode, description: '套餐编码' })
  planCode: SubscriptionPlanCode;

  @ApiProperty({ example: '成长版', description: '套餐名称' })
  planName: string;

  @ApiProperty({ enum: StoreSubscriptionStatus, description: '订阅状态' })
  status: StoreSubscriptionStatus;

  @ApiProperty({ example: 2, description: '订阅生效后的门店账号席位上限' })
  maxAccountSeats: number;

  @ApiProperty({
    example: '2026-05-13T10:00:00.000Z',
    description: '套餐开始时间',
  })
  startsAt: Date;

  @ApiPropertyOptional({
    example: '2026-06-13T10:00:00.000Z',
    description: '套餐到期时间',
  })
  expiresAt: Date | null;

  @ApiProperty({
    type: SubscriptionSeatSummaryDto,
    description: '当前席位概览',
  })
  seatSummary: SubscriptionSeatSummaryDto;
}
