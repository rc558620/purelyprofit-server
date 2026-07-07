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
  MARKETING_POINTS_CHANGE_TYPE_VALUES,
  MARKETING_RECHARGE_TYPE_VALUES,
  type MarketingPointsChangeTypeValue,
  type MarketingRechargeTypeValue,
} from '../marketing.utils';
import { MarketingPageQueryDto } from './marketing-pagination-query.dto';

export class ListRechargesQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({ example: 1, description: '顾客 ID（不传则查全店）' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '顾客 ID 必须是整数' })
  @Min(1, { message: '顾客 ID 必须大于等于 1' })
  customerId?: number;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '查询开始时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '开始时间必须是整数' })
  @Min(0)
  startMs?: number;

  @ApiPropertyOptional({
    example: 1715086399999,
    description: '查询结束时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '结束时间必须是整数' })
  @Min(0)
  endMs?: number;
}

export class ListCustomerRechargesQueryDto extends MarketingPageQueryDto {}

export class ListPointsRecordsQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({ example: 1, description: '顾客 ID（不传则查全店）' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '顾客 ID 必须是整数' })
  @Min(1, { message: '顾客 ID 必须大于等于 1' })
  customerId?: number;

  @ApiPropertyOptional({
    example: 'spend',
    enum: MARKETING_POINTS_CHANGE_TYPE_VALUES,
    description: '积分流水类型筛选',
  })
  @IsOptional()
  @IsIn(MARKETING_POINTS_CHANGE_TYPE_VALUES, { message: '无效的积分流水类型' })
  type?: MarketingPointsChangeTypeValue;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '查询开始时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '开始时间必须是整数' })
  @Min(0)
  startMs?: number;

  @ApiPropertyOptional({
    example: 1715086399999,
    description: '查询结束时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '结束时间必须是整数' })
  @Min(0)
  endMs?: number;
}

export class ListCustomerPointsRecordsQueryDto extends MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 'spend',
    enum: MARKETING_POINTS_CHANGE_TYPE_VALUES,
    description: '积分流水类型筛选',
  })
  @IsOptional()
  @IsIn(MARKETING_POINTS_CHANGE_TYPE_VALUES, { message: '无效的积分流水类型' })
  type?: MarketingPointsChangeTypeValue;

  @ApiPropertyOptional({
    example: 1715000000000,
    description: '查询开始时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '开始时间必须是整数' })
  @Min(0)
  startMs?: number;

  @ApiPropertyOptional({
    example: 1715086399999,
    description: '查询结束时间（毫秒时间戳，包含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '结束时间必须是整数' })
  @Min(0)
  endMs?: number;
}

export class CreateRechargeDto {
  @ApiPropertyOptional({ example: 1, description: '顾客 ID' })
  @Transform(transformOptionalInt)
  @IsInt({ message: '顾客 ID 必须是整数' })
  @Min(1, { message: '顾客 ID 必须大于等于 1' })
  customerId: number;

  @ApiPropertyOptional({
    example: 10000,
    description: '充值金额（分），gift 类型允许 0',
  })
  @IsInt({ message: '充值金额必须是整数' })
  @Min(0, { message: '充值金额不能为负' })
  amount: number;

  @ApiPropertyOptional({
    example: 1000,
    description: '赠送金额（分），不赠则传 0',
  })
  @IsOptional()
  @IsInt({ message: '赠送金额必须是整数' })
  @Min(0, { message: '赠送金额不能为负' })
  giftAmount?: number;

  @ApiPropertyOptional({
    example: 'recharge',
    enum: MARKETING_RECHARGE_TYPE_VALUES,
    description: '类型（recharge=储值 gift=纯赠送 refund=退款）',
  })
  @IsOptional()
  @IsIn(MARKETING_RECHARGE_TYPE_VALUES, { message: '无效的充值类型' })
  type?: MarketingRechargeTypeValue;

  @ApiPropertyOptional({ example: 3, description: '关联活动 ID（可选）' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '活动 ID 必须是整数' })
  @Min(1)
  promotionId?: number;

  @ApiPropertyOptional({ example: '半年卡储值', description: '备注（可选）' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;
}
