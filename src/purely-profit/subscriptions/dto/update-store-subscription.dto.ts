import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionPlanCode } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateStoreSubscriptionDto {
  @ApiProperty({
    enum: SubscriptionPlanCode,
    description: '目标套餐编码，CUSTOM 表示自定义席位包',
  })
  @IsEnum(SubscriptionPlanCode, { message: '套餐编码不合法' })
  planCode: SubscriptionPlanCode;

  @ApiPropertyOptional({
    example: 5,
    description: '当 planCode 为 CUSTOM 时需要传入自定义席位数',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义席位数必须是整数' })
  @Min(1, { message: '自定义席位数至少为 1' })
  maxAccountSeats?: number;

  @ApiPropertyOptional({
    example: '2026-06-13T10:00:00.000Z',
    description: '套餐到期时间，未传表示不限制到期时间',
  })
  @IsOptional()
  @IsDateString({}, { message: '套餐到期时间格式不正确' })
  expiresAt?: string;
}
