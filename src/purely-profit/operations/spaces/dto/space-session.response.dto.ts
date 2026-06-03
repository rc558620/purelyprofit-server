import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, ValidateNested } from 'class-validator';
import {
  PaginationMetaDto,
} from '../../../stores/dto/store-response.dto';
import {
  SALES_PAYMENT_METHOD_VALUES,
  type SalesPaymentMethodValue,
} from '../../sales-record/sales-record.types';
import { SalesRecordResponseDto } from '../../sales-record/dto/sales-record.dto';
import {
  SPACE_BILLING_MODE_VALUES,
  SPACE_SESSION_STATUS_VALUES,
  SPACE_STATUS_VALUES,
  type SpaceBillingModeValue,
  type SpaceSessionStatusValue,
  type SpaceStatusValue,
} from '../spaces.constants';
import {
  SPACE_COUNTDOWN_FEE_MODE_VALUES,
  SPACE_TIME_FEE_MODE_VALUES,
  type SpaceCountdownFeeModeValue,
  type SpaceTimeFeeModeValue,
} from './space-session.constants';

export class SpaceSessionItemResponseDto {
  @ApiProperty({ example: 'SYS_TIME_BILLING', description: '商品 ID' })
  productId: string;

  @ApiProperty({ example: '台位费（固定）', description: '商品名称' })
  productName: string;

  @ApiProperty({ example: '场地费', description: '商品分类' })
  categoryName: string;

  @ApiProperty({ example: 68, description: '销售单价（元）' })
  salePrice: number;

  @ApiProperty({ example: 68, description: '单件利润（元）' })
  profit: number;

  @ApiProperty({ example: 1, description: '数量' })
  quantity: number;
}

export class SpaceSessionRenewRecordResponseDto {
  @ApiProperty({ example: '1', description: '续费记录 ID' })
  id: string;

  @ApiProperty({ example: 30, description: '续费金额（元）' })
  amount: number;

  @ApiProperty({ example: 26, description: '换算追加分钟数' })
  addedMinutes: number;

  @ApiProperty({
    example: 'wechat',
    description: '支付方式',
    enum: SALES_PAYMENT_METHOD_VALUES,
  })
  paymentMethod: SalesPaymentMethodValue;

  @ApiPropertyOptional({ example: 'MT123456', description: '团购券码' })
  grouponCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '团购平台' })
  grouponPlatform?: string;

  @ApiPropertyOptional({ example: '补差价', description: '备注' })
  note?: string;

  @ApiProperty({ example: 1715695200000, description: '续费时间戳（毫秒）' })
  renewedAt: number;
}

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

export class SpaceSessionResponseDto {
  @ApiProperty({ example: '1', description: '会话 ID' })
  id: string;

  @ApiProperty({ example: '1', description: '空间 ID' })
  spaceId: string;

  @ApiProperty({ example: 'A台', description: '空间名称快照' })
  spaceName: string;

  @ApiProperty({ example: '台球台', description: '空间类型快照' })
  spaceType: string;

  @ApiPropertyOptional({ example: '张先生', description: '顾客姓名' })
  guestName?: string;

  @ApiPropertyOptional({ example: '13800138000', description: '顾客电话' })
  guestPhone?: string;

  @ApiPropertyOptional({ example: 4, description: '顾客人数' })
  guestCount?: number;

  @ApiProperty({ example: 1715691600000, description: '开台时间戳（毫秒）' })
  startTime: number;

  @ApiPropertyOptional({
    example: 1715695200000,
    description: '结账时间戳（毫秒）',
  })
  endTime?: number;

  @ApiProperty({
    example: 'timed',
    description: '计费模式',
    enum: SPACE_BILLING_MODE_VALUES,
  })
  billingMode: SpaceBillingModeValue;

  @ApiPropertyOptional({
    example: 68,
    description: '计时单价/倒计时台位费（元）',
  })
  hourlyRate?: number;

  @ApiPropertyOptional({ example: 136, description: '结账后的时间费用（元）' })
  timeCost?: number;

  @ApiPropertyOptional({ example: 60, description: '倒计时总时长（分钟）' })
  countdownMinutes?: number;

  @ApiPropertyOptional({ example: true, description: '倒计时到期是否自动结账' })
  autoCheckout?: boolean;

  @ApiPropertyOptional({
    example: 'cash',
    description: '预付支付方式',
    enum: SALES_PAYMENT_METHOD_VALUES,
  })
  prepaidPaymentMethod?: SalesPaymentMethodValue;

  @ApiPropertyOptional({ example: 'MT123456', description: '预付团购券码' })
  prepaidGrouponCode?: string;

  @ApiPropertyOptional({ example: '美团团购券', description: '预付备注' })
  prepaidNote?: string;

  @ApiPropertyOptional({ example: 88, description: '预付金额（元）' })
  prepaidAmount?: number;

  @ApiProperty({ type: [SpaceSessionItemResponseDto], description: '消费明细' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpaceSessionItemResponseDto)
  items: SpaceSessionItemResponseDto[];

  @ApiProperty({ example: 0, description: '商品费用合计（元）' })
  itemsCost: number;

  @ApiProperty({
    type: [SpaceSessionRenewRecordResponseDto],
    description: '续费记录',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpaceSessionRenewRecordResponseDto)
  renewRecords: SpaceSessionRenewRecordResponseDto[];

  @ApiProperty({
    example: 'active',
    description: '会话状态',
    enum: SPACE_SESSION_STATUS_VALUES,
  })
  status: SpaceSessionStatusValue;

  @ApiPropertyOptional({ example: '123', description: '关联销售订单 ID' })
  orderId?: string;

  @ApiProperty({ example: 1715691600000, description: '创建时间戳（毫秒）' })
  createdAt: number;
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

export class RenewSpaceSessionResponseDto {
  @ApiProperty({
    type: () => SpaceSessionRenewRecordResponseDto,
    description: '本次续费记录',
  })
  @ValidateNested()
  @Type(() => SpaceSessionRenewRecordResponseDto)
  renewRecord: SpaceSessionRenewRecordResponseDto;

  @ApiProperty({
    type: () => SpaceSessionResponseDto,
    description: '续费后的会话信息',
  })
  @ValidateNested()
  @Type(() => SpaceSessionResponseDto)
  session: SpaceSessionResponseDto;
}

export class TransferSpaceSessionResponseDto {
  @ApiProperty({ example: true, description: '是否换房成功' })
  @IsBoolean()
  ok: boolean;

  @ApiPropertyOptional({
    example: '目标空间当前不可换入',
    description:
      '换房失败原因（ok=false 时后端通过异常返回，保留此字段供前端接口类型对齐）',
  })
  reason?: string;

  @ApiProperty({
    type: () => SpaceSessionResponseDto,
    description: '换房后的会话信息',
  })
  @ValidateNested()
  @Type(() => SpaceSessionResponseDto)
  session: SpaceSessionResponseDto;

  @ApiProperty({
    example: 'idle',
    description: '原空间回流后的状态',
    enum: SPACE_STATUS_VALUES,
  })
  sourceSpaceStatus: SpaceStatusValue;

  @ApiProperty({
    example: 'occupied',
    description: '目标空间状态',
    enum: SPACE_STATUS_VALUES,
  })
  targetSpaceStatus: SpaceStatusValue;
}

export class PaginatedSpaceSessionsResponseDto {
  @ApiProperty({
    type: () => SpaceSessionResponseDto,
    isArray: true,
    description: '会话列表',
  })
  items: SpaceSessionResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页元信息' })
  meta: PaginationMetaDto;
}
