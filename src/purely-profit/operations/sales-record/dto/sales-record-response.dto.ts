import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffRole } from '@prisma/client';
import { PaginationMetaDto } from '../../../stores/dto/store-response.dto';
import {
  SALES_CALC_MODE_VALUES,
  SALES_PAYMENT_METHOD_VALUES,
  type SalesCalcModeValue,
  type SalesPaymentMethodValue,
} from '../sales-record.types';
import { ScanOrderingAmountSummaryDto } from './sales-record-amount-summary.dto';
import { SalesRecordItemResponseDto } from './sales-record-item.dto';
import { SalesStatsResponseDto } from './sales-record-stats.dto';

/** 销售记录支付方式取值：兼容扫码点餐余额支付（balance）。 */
export type SalesRecordPaymentMethodValue = SalesPaymentMethodValue | 'balance';

/** 销售记录支付方式枚举（Swagger 展示用）。 */
export const SALES_RECORD_PAYMENT_METHOD_VALUES = [
  ...SALES_PAYMENT_METHOD_VALUES,
  'balance',
] as const satisfies readonly SalesRecordPaymentMethodValue[];

export class SalesRecordResponseDto {
  @ApiProperty({ example: '1', description: '销售记录 ID' })
  id: string;

  @ApiProperty({ example: '#20260514-001', description: '订单号' })
  orderNo: string;

  @ApiProperty({ type: [SalesRecordItemResponseDto], description: '商品明细' })
  items: SalesRecordItemResponseDto[];

  @ApiProperty({ example: 88.5, description: '总营业额（元）' })
  totalRevenue: number;

  @ApiProperty({ example: 23.6, description: '总利润（元）' })
  totalProfit: number;

  @ApiProperty({ example: 8, description: '总销售件数' })
  totalQuantity: number;

  @ApiProperty({
    example: 'cash',
    enum: SALES_RECORD_PAYMENT_METHOD_VALUES,
    description: '支付方式；balance 为扫码点餐余额支付',
  })
  paymentMethod: SalesRecordPaymentMethodValue;

  @ApiProperty({
    example: '美团团购',
    description:
      '支付方式展示标签（团购场景自动拼接平台名称，如"美团团购""抖音团购"；非团购场景与 paymentMethod 对应的中文一致）',
  })
  paymentLabel: string;

  @ApiProperty({
    example: 'business',
    enum: SALES_CALC_MODE_VALUES,
    description: '结算模式',
  })
  calcMode: SalesCalcModeValue;

  @ApiPropertyOptional({ example: '晚高峰补录', description: '备注' })
  note?: string;

  // ─── 手工补录（录入订单）元数据（可选）───────────────────────────────────

  @ApiPropertyOptional({
    example: false,
    description: '是否为手工补录订单（商家端「录入订单」补录的线下交易）',
  })
  manualEntry?: boolean;

  @ApiPropertyOptional({
    example: 'dineIn',
    enum: ['dineIn', 'takeaway', 'platform'],
    description:
      '手工补录：就餐方式（dineIn 堂食/团购到店、takeaway 自取、platform 第三方外卖）',
  })
  diningMode?: 'dineIn' | 'takeaway' | 'platform';

  @ApiPropertyOptional({
    example: 'meituanVoucher',
    enum: ['meituan', 'eleme', 'meituanVoucher', 'douyin', 'dianping', 'other'],
    description:
      '手工补录：来源渠道（美团外卖/饿了么/美团团购/抖音团购/大众点评/其他平台）',
  })
  sourceChannel?:
    | 'meituan'
    | 'eleme'
    | 'meituanVoucher'
    | 'douyin'
    | 'dianping'
    | 'other';

  @ApiPropertyOptional({
    example: 4,
    description: '手工补录：就餐人数；非手工补录订单为 null',
    nullable: true,
  })
  guestCount?: number | null;

  @ApiPropertyOptional({
    example: 'ME20260816-123456',
    description: '手工补录：第三方平台单号（美团/饿了么等平台原始订单号）',
  })
  externalOrderNo?: string;

  @ApiPropertyOptional({
    example: '13800138000',
    description: '手工补录：顾客手机号（用于自取/外送联系）',
  })
  customerPhone?: string;

  @ApiPropertyOptional({
    example: '张三',
    description: '操作员姓名快照；主账号或无员工档案时为 null',
  })
  operatorName?: string | null;

  @ApiPropertyOptional({
    enum: StaffRole,
    example: 'owner',
    description:
      '操作员角色（owner=老板/manager=店长/staff=收银员）；主账号或无员工档案时为 null',
    nullable: true,
  })
  operatorRole?: StaffRole | null;

  @ApiProperty({ example: 1715695200000, description: '销售时间戳（毫秒）' })
  date: number;

  @ApiProperty({ example: 1715695201000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1715698800000,
    description: '退款完成时间戳（毫秒）；未退款时为 null',
    nullable: true,
  })
  refundedAt?: number | null;

  // ─── 团购 / 券 / 平台结算元数据（可选）───────────────────────────────────

  @ApiPropertyOptional({
    example: 'groupon_voucher',
    description: '顾客实际支付方式（如 groupon_voucher）',
  })
  customerPaymentMethod?: string;

  @ApiPropertyOptional({ example: 'MT123456', description: '团购券码' })
  grouponCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '团购平台' })
  grouponPlatform?: string;

  @ApiPropertyOptional({ example: 'online', description: '结算渠道' })
  settlementChannel?: string;

  @ApiPropertyOptional({ example: 'V20260710001', description: '券码' })
  voucherCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '券所属平台' })
  voucherPlatform?: string;

  @ApiPropertyOptional({ example: 100, description: '券面额（元）' })
  voucherFaceAmount?: number;

  @ApiPropertyOptional({ example: 'pending', description: '平台结算状态' })
  settlementStatus?: string;

  @ApiPropertyOptional({ example: 80, description: '平台应收金额（元）' })
  platformReceivable?: number;

  @ApiPropertyOptional({ example: 75, description: '平台已结金额（元）' })
  platformSettledAmount?: number;

  @ApiPropertyOptional({ example: 5, description: '平台手续费（元）' })
  platformFee?: number;

  @ApiPropertyOptional({
    type: ScanOrderingAmountSummaryDto,
    description:
      '扫码点餐订单金额汇总（规格/优惠清单数据源）；仅扫码点餐订单返回，普通订单缺省',
  })
  amountSummary?: ScanOrderingAmountSummaryDto;
}

export class SalesRecordListResponseDto {
  @ApiProperty({ type: [SalesRecordResponseDto], description: '销售记录列表' })
  items: SalesRecordResponseDto[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: '分页信息',
  })
  meta: PaginationMetaDto;

  @ApiPropertyOptional({
    type: SalesStatsResponseDto,
    description: '当前周期统计数据（总营业额/总利润/订单笔数/平均客单价）',
  })
  summary?: SalesStatsResponseDto;
}

// ─── 同模块 DTO 已按职责拆分为多个文件，此处统一再导出以保持引用路径稳定 ─────
export {
  ScanOrderingAmountSummaryDto,
  ScanOrderingDiscountItemDto,
} from './sales-record-amount-summary.dto';
export {
  SalesProductResponseDto,
  SalesRecordItemResponseDto,
} from './sales-record-item.dto';
export {
  PreviewSalesRecordItemDto,
  PreviewSalesRecordResponseDto,
} from './sales-record-preview.dto';
export {
  SalesDailyRowDto,
  SalesReportResponseDto,
  SalesReportSummaryDto,
} from './sales-record-report.dto';
export { SalesStatsResponseDto } from './sales-record-stats.dto';
