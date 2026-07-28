import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ServiceCallType } from '@prisma/client';

export class CreateClubServiceCallDto {
  @ApiProperty({ description: 'Home 当前选中门店 ID', minimum: 1 })
  @Type(() => Number)
  @IsInt({ message: 'storeId 必须是整数' })
  @Min(1, { message: 'storeId 必须大于 0' })
  storeId: number;

  @ApiProperty({ enum: ServiceCallType, description: '服务呼叫类型' })
  @IsEnum(ServiceCallType, { message: 'type 不受支持' })
  type: ServiceCallType;

  @ApiPropertyOptional({ description: '顾客补充说明', maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'remark 必须是字符串' })
  @MaxLength(200, { message: 'remark 不能超过 200 个字符' })
  remark?: string;
}
