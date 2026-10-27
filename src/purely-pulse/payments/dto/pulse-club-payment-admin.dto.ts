import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 死信处理状态取值，与 ClubPaymentCallbackFailure.status 对齐 */
export const CLUB_CALLBACK_FAILURE_STATUSES = [
  'pending',
  'resolved',
  'ignore',
] as const;
export type ClubCallbackFailureStatus =
  (typeof CLUB_CALLBACK_FAILURE_STATUSES)[number];

export class PulseCallbackFailureListQueryDto {
  @ApiPropertyOptional({
    example: 'pending',
    description: '死信处理状态筛选：pending / resolved / ignore；不传返回全部',
  })
  @IsOptional()
  @IsIn(CLUB_CALLBACK_FAILURE_STATUSES, {
    message: 'status 必须是 pending / resolved / ignore',
  })
  status?: ClubCallbackFailureStatus;

  @ApiPropertyOptional({ example: 50, description: '返回条数，最大 200' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(200, { message: 'limit 最大为 200' })
  limit?: number;
}

export class PulseResolveCallbackFailureDto {
  @ApiProperty({
    example: 'resolved',
    description: '处理结果：resolved=已补单或已处理；ignore=确认无需处理',
  })
  @IsIn(['resolved', 'ignore'], {
    message: 'status 必须是 resolved 或 ignore',
  })
  status: 'resolved' | 'ignore';

  @ApiPropertyOptional({
    example: '已按微信流水补单成功',
    description: '处理备注，便于事后追溯',
  })
  @IsOptional()
  @IsString({ message: 'note 必须是字符串' })
  @MaxLength(500, { message: 'note 最长 500 字' })
  note?: string;
}

export class PulseClubCallbackFailureItemDto {
  @ApiProperty({ example: 1, description: '死信记录 ID' })
  id: number;

  @ApiProperty({ example: 'RC1770000000000ABC', description: '业务订单号' })
  orderNo: string;

  @ApiProperty({ example: 'recharge', description: '订单类型' })
  orderType: string;

  @ApiPropertyOptional({ example: 11, description: '所属门店 ID' })
  storeId: number | null;

  @ApiPropertyOptional({
    example: '4200001234567890',
    description: '微信流水号',
  })
  transactionId: string | null;

  @ApiPropertyOptional({ example: 50000, description: '订单金额，单位分' })
  amountFen: number | null;

  @ApiProperty({ example: '订单不存在', description: '失败原因摘要' })
  reason: string;

  @ApiProperty({ example: 5, description: '队列已尝试次数' })
  attempts: number;

  @ApiProperty({ example: 'pending', description: '处理状态' })
  status: string;

  @ApiPropertyOptional({ example: '已补单', description: '处理备注' })
  resolutionNote: string | null;

  @ApiProperty({ description: '首次记录时间' })
  createdAt: Date;

  @ApiPropertyOptional({ description: '处理时间' })
  resolvedAt: Date | null;
}

export class PulseClubCallbackFailureListResponseDto {
  @ApiProperty({
    type: [PulseClubCallbackFailureItemDto],
    description: '支付回调死信列表',
  })
  items: PulseClubCallbackFailureItemDto[];
}

export class PulseClubRechargeOrderInspectDto {
  @ApiProperty({ example: 'RC1770000000000ABC', description: '业务订单号' })
  orderNo: string;

  @ApiPropertyOptional({
    example: 'paid',
    description: '本地订单状态；订单不存在时为 null',
  })
  localStatus: string | null;

  @ApiPropertyOptional({ example: 50000, description: '本地订单金额，单位分' })
  localAmountFen: number | null;

  @ApiPropertyOptional({
    example: 'SUCCESS',
    description: '微信侧交易状态；查不到时为 null',
  })
  wechatTradeState: string | null;

  @ApiPropertyOptional({
    example: '4200001234567890',
    description: '微信侧流水号',
  })
  wechatTransactionId: string | null;

  @ApiPropertyOptional({
    example: 50000,
    description: '微信侧实际收款金额，单位分',
  })
  wechatAmountFen: number | null;

  @ApiProperty({
    example: false,
    description: '本次是否触发了补落账（微信已支付且本地未落账时会自动补）',
  })
  settled: boolean;

  @ApiPropertyOptional({
    example: 'paid',
    description: '补落账执行后的本地订单状态',
  })
  statusAfterRetry: string | null;
}
