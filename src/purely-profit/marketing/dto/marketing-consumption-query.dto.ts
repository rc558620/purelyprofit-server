import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { transformOptionalInt } from '../../stores/dto/store-response.dto';
import {
  MARKETING_PAY_TYPE_VALUES,
  type MarketingPayTypeValue,
} from '../marketing.utils';

export class CreateConsumptionDto {
  @ApiPropertyOptional({ example: 1, description: '顾客 ID' })
  @Transform(transformOptionalInt)
  @IsInt({ message: '顾客 ID 必须是整数' })
  @Min(1)
  customerId: number;

  @ApiPropertyOptional({ example: 5800, description: '消费金额（分）' })
  @IsInt({ message: '消费金额必须是整数' })
  @Min(1, { message: '消费金额必须大于 0' })
  amount: number;

  @ApiPropertyOptional({
    example: 2000,
    description: '余额支付金额（分），0 表示全部现金',
  })
  @IsOptional()
  @IsInt({ message: '余额支付金额必须是整数' })
  @Min(0)
  balancePaid?: number;

  @ApiPropertyOptional({ example: 0, description: '积分抵扣金额（分）' })
  @IsOptional()
  @IsInt({ message: '积分抵扣金额必须是整数' })
  @Min(0)
  pointsDeducted?: number;

  @ApiPropertyOptional({
    example: 'cash',
    enum: MARKETING_PAY_TYPE_VALUES,
    description: '支付方式',
  })
  @IsOptional()
  @IsIn(MARKETING_PAY_TYPE_VALUES, { message: '无效的支付方式' })
  payType?: MarketingPayTypeValue;

  @ApiPropertyOptional({ example: '拿铁 × 2', description: '商品简述（可选）' })
  @IsOptional()
  @IsString({ message: '商品简述必须是字符串' })
  @MaxLength(200, { message: '商品简述最长 200 个字符' })
  itemsSummary?: string;

  @ApiPropertyOptional({ example: 3, description: '关联活动 ID（可选）' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '活动 ID 必须是整数' })
  @Min(1)
  promotionId?: number;
}
