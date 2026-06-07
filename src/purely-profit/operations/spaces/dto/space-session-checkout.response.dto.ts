import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { SalesRecordResponseDto } from '../../sales-record/dto/sales-record.dto';
import {
  SPACE_STATUS_VALUES,
  type SpaceStatusValue,
} from '../spaces.constants';
import {
  SPACE_COUNTDOWN_FEE_MODE_VALUES,
  SPACE_TIME_FEE_MODE_VALUES,
  type SpaceCountdownFeeModeValue,
  type SpaceTimeFeeModeValue,
} from './space-session.constants';
import { SpaceSessionResponseDto } from './space-session-shared.response.dto';

export class CheckoutSpaceSessionPreviewSummaryDto {
  @ApiProperty({ example: 95, description: '本次计费总分钟数' })
  durationMinutes: number;

  @ApiProperty({ example: '1小时35分钟', description: '时长文案' })
  durationLabel: string;

  @ApiProperty({ example: 108, description: '时间费用（元）' })
  timeCost: number;

  @ApiProperty({ example: 26, description: '商品费用（元）' })
  itemsCost: number;

  @ApiProperty({ example: 30, description: '续费抵扣（元）' })
  renewDeduction: number;

  @ApiProperty({ example: 20, description: '预付抵扣（元）' })
  prepaidDeduction: number;

  @ApiProperty({ example: 84, description: '待付总金额（元）' })
  totalAmount: number;

  @ApiPropertyOptional({
    example: 'timed',
    description: '通用台位费计费口径：timed=按实际计时，unit_price=按单价',
    enum: SPACE_TIME_FEE_MODE_VALUES,
  })
  timeFeeMode?: SpaceTimeFeeModeValue;

  @ApiPropertyOptional({
    example: 'timed',
    description:
      '兼容旧版前端的倒计时台位费口径：timed=按实际计时，fixed=按固定台位费',
    enum: SPACE_COUNTDOWN_FEE_MODE_VALUES,
  })
  countdownFeeMode?: SpaceCountdownFeeModeValue;
}

export class CheckoutSpaceSessionPreviewResponseDto {
  @ApiProperty({ example: 'space_lock_xxx', description: '锁单 ID' })
  lockId: string;

  @ApiProperty({ example: 1715695200000, description: '锁单时间戳（毫秒）' })
  lockedAt: number;

  @ApiProperty({
    example: 1715695500000,
    description: '锁单过期时间戳（毫秒）',
  })
  expiresAt: number;

  @ApiProperty({
    type: () => CheckoutSpaceSessionPreviewSummaryDto,
    description: '结账预览摘要',
  })
  @ValidateNested()
  @Type(() => CheckoutSpaceSessionPreviewSummaryDto)
  preview: CheckoutSpaceSessionPreviewSummaryDto;
}

export class CheckoutSpaceSessionResponseDto {
  @ApiProperty({
    type: () => SpaceSessionResponseDto,
    description: '结账后的会话信息',
  })
  @ValidateNested()
  @Type(() => SpaceSessionResponseDto)
  session: SpaceSessionResponseDto;

  @ApiProperty({
    example: 'cleaning',
    description: '结账后空间回流状态',
    enum: SPACE_STATUS_VALUES,
  })
  spaceStatus: SpaceStatusValue;

  @ApiPropertyOptional({
    example: '12',
    description: '本次结账联动取消的预约 ID',
  })
  cancelledReservationId?: string;

  @ApiProperty({
    type: () => SalesRecordResponseDto,
    description: '本次结账生成的销售单',
  })
  @ValidateNested()
  @Type(() => SalesRecordResponseDto)
  salesOrder: SalesRecordResponseDto;
}
