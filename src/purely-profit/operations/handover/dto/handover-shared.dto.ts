import { ApiProperty } from '@nestjs/swagger';
import { SalesPaymentMethod } from '@prisma/client';

export const HandoverModeDto = {
  SELF_MAIN_ACCOUNT: 'self_main_account',
  SUB_ACCOUNT: 'sub_account',
} as const;

export type HandoverModeDto =
  (typeof HandoverModeDto)[keyof typeof HandoverModeDto];

export const HandoverStatusDto = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type HandoverStatusDto =
  (typeof HandoverStatusDto)[keyof typeof HandoverStatusDto];

export const HandoverRecordDisplayStatusDto = {
  DONE: 'done',
  ACTIVE: 'active',
} as const;

export type HandoverRecordDisplayStatusDto =
  (typeof HandoverRecordDisplayStatusDto)[keyof typeof HandoverRecordDisplayStatusDto];

export const HandoverRecordsPresetDto = {
  TODAY: 'today',
  SEVEN_DAYS: '7d',
  THIRTY_DAYS: '30d',
} as const;

export type HandoverRecordsPresetDto =
  (typeof HandoverRecordsPresetDto)[keyof typeof HandoverRecordsPresetDto];

export class HandoverRevenueSummaryDto {
  @ApiProperty({ example: 128, description: '附加收入' })
  additionalRevenue: number;

  @ApiProperty({ example: 520, description: '空间收入' })
  spaceRevenue: number;

  @ApiProperty({ example: 88, description: '退款金额' })
  refundAmount: number;

  @ApiProperty({ example: 1368, description: '总营业额' })
  totalRevenue: number;

  @ApiProperty({ example: 12, description: '订单数' })
  orderCount: number;

  @ApiProperty({ example: 200, description: '备用金' })
  pettyCache: number;
}

export class HandoverPaymentItemDto {
  @ApiProperty({
    description: '支付方式',
    enum: [...Object.values(SalesPaymentMethod), 'groupon_voucher'],
    example: SalesPaymentMethod.wechat,
  })
  method: SalesPaymentMethod | 'groupon_voucher';

  @ApiProperty({ example: '微信', description: '支付方式中文标签' })
  label: string;

  @ApiProperty({ example: 668, description: '收款金额' })
  amount: number;

  @ApiProperty({ example: 0.48, description: '金额占比' })
  ratio: number;

  @ApiProperty({ example: '#22c55e', description: '展示颜色' })
  color: string;
}

export class HandoverOrderItemDto {
  @ApiProperty({ example: '101', description: '订单项 ID' })
  id: string;

  @ApiProperty({ example: '招牌拿铁', description: '商品名称' })
  productName: string;

  @ApiProperty({ example: 2, description: '销量' })
  quantity: number;

  @ApiProperty({ example: 88, description: '金额' })
  totalRevenue: number;

  @ApiProperty({ example: '微信', description: '支付方式标签' })
  paymentLabel: string;

  @ApiProperty({ example: '#22c55e', description: '支付方式颜色' })
  paymentColor: string;

  @ApiProperty({ example: 1748765400000, description: '订单时间戳(ms)' })
  date: number;

  @ApiProperty({ example: 18, description: '当前库存', required: false, nullable: true })
  currentStock?: number | null;

  @ApiProperty({ example: '杯', description: '库存单位', required: false, nullable: true })
  stockUnit?: string | null;
}
