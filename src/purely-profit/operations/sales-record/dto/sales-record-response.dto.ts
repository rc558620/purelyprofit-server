import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffRole } from '@prisma/client';
import { IsArray, IsBoolean, IsNumber, IsString } from 'class-validator';
import { PaginationMetaDto } from '../../../stores/dto/store-response.dto';
import {
  SALES_CALC_MODE_VALUES,
  SALES_PAYMENT_METHOD_VALUES,
  type SalesCalcModeValue,
  type SalesPaymentMethodValue,
} from '../sales-record.types';

/** 销售记录支付方式取值：兼容扫码点餐余额支付（balance）。 */
export type SalesRecordPaymentMethodValue = SalesPaymentMethodValue | 'balance';

/** 销售记录支付方式枚举（Swagger 展示用）。 */
export const SALES_RECORD_PAYMENT_METHOD_VALUES = [
  ...SALES_PAYMENT_METHOD_VALUES,
  'balance',
] as const satisfies readonly SalesRecordPaymentMethodValue[];

export class SalesProductResponseDto {
  @ApiProperty({ example: '1', description: '商品 ID' })
  id: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  name: string;

  @ApiProperty({ example: '饮品', description: '商品分类' })
  category: string;

  @ApiProperty({ example: 'COLA001', description: '商品编号' })
  code: string;

  @ApiProperty({ example: 2.5, description: '单件利润（对应前端 price）' })
  price: number;

  @ApiProperty({ example: 6.5, description: '销售单价（对应前端 salePrice）' })
  salePrice: number;

  @ApiProperty({ example: 0, description: '当前追加数量，固定返回 0' })
  quantity: number;
}

export class SalesRecordItemResponseDto {
  @ApiProperty({
    example: '1',
    description: '商品 ID；手动录单为生成的字符串 ID',
  })
  productId: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称快照' })
  productName: string;

  @ApiProperty({ example: '饮品', description: '商品分类快照' })
  categoryName: string;

  @ApiProperty({ example: 6.5, description: '销售单价（元）' })
  salePrice: number;

  @ApiProperty({ example: 2.5, description: '单件利润（元）' })
  profit: number;

  @ApiProperty({ example: 2, description: '销售数量' })
  quantity: number;

  @ApiProperty({
    example: 13,
    description: '商品小计 = salePrice × quantity（元）',
  })
  subtotal: number;

  @ApiPropertyOptional({
    example: ['不辣', '加鱼丸'],
    description: '商品规格名称快照；仅扫码点餐订单返回，普通订单缺省',
  })
  specs?: string[];

  @ApiPropertyOptional({
    example: 98,
    description:
      '优惠前单价（元，未扣任何优惠）；仅扫码点餐订单返回，普通订单缺省',
  })
  originalUnitPrice?: number;
}

// ---------------------------------------------------------------------------
// 销售订单预览（不落库，仅返回后端计算金额供前端展示）
// ---------------------------------------------------------------------------

export class PreviewSalesRecordItemDto {
  @ApiProperty({ example: '1', description: '商品 ID' })
  productId: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  productName: string;

  @ApiProperty({ example: '饮品', description: '商品分类' })
  categoryName: string;

  @ApiProperty({ example: 6.5, description: '销售单价（元）' })
  salePrice: number;

  @ApiProperty({ example: 2.5, description: '单件利润（元）' })
  profit: number;

  @ApiProperty({ example: 2, description: '销售数量' })
  quantity: number;

  @ApiProperty({
    example: 13.0,
    description: '营业额小计（salePrice × quantity，由后端计算）',
  })
  revenueSubtotal: number;

  @ApiProperty({
    example: 5.0,
    description: '利润小计（profit × quantity，由后端计算）',
  })
  profitSubtotal: number;
}

export class PreviewSalesRecordResponseDto {
  @ApiProperty({
    type: [PreviewSalesRecordItemDto],
    description: '商品明细（含后端计算小计）',
  })
  items: PreviewSalesRecordItemDto[];

  @ApiProperty({
    example: 88.5,
    description: '总营业额（元，由后端根据明细重算）',
  })
  totalRevenue: number;

  @ApiProperty({
    example: 23.6,
    description: '总利润（元，由后端根据明细重算）',
  })
  totalProfit: number;

  @ApiProperty({ example: 8, description: '总销售件数（由后端根据明细重算）' })
  totalQuantity: number;
}

export class ScanOrderingDiscountItemDto {
  @IsString()
  @ApiProperty({
    example: '会员等级折扣 8折',
    description: '优惠项展示标签（如“会员等级折扣 8折”“满50减8”）',
  })
  label: string;

  @IsNumber()
  @ApiProperty({
    example: -20.5,
    description: '优惠金额（元）；负数表示减免',
  })
  amount: number;

  @IsBoolean()
  @ApiProperty({
    example: false,
    description: '被覆盖/失效优惠：true 时前端划线展示',
  })
  isStrikethrough: boolean;
}

/** 扫码点餐订单金额汇总（元，全部由后端计算，前端只读展示）。 */
export class ScanOrderingAmountSummaryDto {
  @IsNumber()
  @ApiProperty({ example: 508, description: '商品基础价合计（元）' })
  itemOriginalAmount: number;

  @IsNumber()
  @ApiProperty({ example: 16, description: '规格加价合计（元）' })
  specificationExtraAmount: number;

  @IsNumber()
  @ApiProperty({
    example: 404.8,
    description: '应付金额（元，含所有优惠与积分抵扣）',
  })
  payableAmount: number;

  @IsNumber()
  @ApiProperty({
    example: 119.2,
    description: '总优惠金额（元，= 商品原价 + 规格加价 − 应付，由后端计算）',
  })
  discountAmount: number;

  @IsNumber()
  @ApiProperty({ example: 0, description: '积分抵扣金额（元）' })
  pointsDeductAmount: number;

  @IsArray()
  @ApiProperty({
    type: [ScanOrderingDiscountItemDto],
    description: '优惠清单明细（仅减免项，amount 为负）',
  })
  discountItems: ScanOrderingDiscountItemDto[];
}

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

export class SalesStatsResponseDto {
  @ApiProperty({ example: 1200.5, description: '当前筛选周期总营业额' })
  totalRevenue: number;

  @ApiProperty({ example: 320.2, description: '当前筛选周期总利润' })
  totalProfit: number;

  @ApiProperty({ example: 18, description: '当前筛选周期订单笔数' })
  orderCount: number;

  @ApiProperty({ example: 66.69, description: '平均客单价' })
  avgOrderValue: number;

  @ApiPropertyOptional({
    example: 12.5,
    description: '较上期营业额变化百分比；无对比数据时为 null',
  })
  compareLastPeriod: number | null;
}

export class SalesReportSummaryDto {
  @ApiProperty({ example: 56, description: '销售总数量' })
  totalQuantity: number;

  @ApiProperty({ example: 1280, description: '销售总收入' })
  totalRevenue: number;

  @ApiProperty({ example: 12, description: '销售明细条数' })
  orderCount: number;

  @ApiProperty({ example: 106.67, description: '平均单条销售额' })
  avgOrderValue: number;
}

export class SalesDailyRowDto {
  @ApiProperty({ example: '1715644800000-12', description: '聚合行 ID' })
  id: string;

  @ApiProperty({ example: '05/14', description: '日期标签' })
  dateLabel: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  productName: string;

  @ApiProperty({ example: 8, description: '销售数量' })
  quantity: number;

  @ApiProperty({ example: 52, description: '销售收入' })
  revenue: number;
}

export class SalesReportResponseDto {
  @ApiProperty({ type: SalesReportSummaryDto, description: '销售报表概况' })
  summary: SalesReportSummaryDto;

  @ApiProperty({ type: [SalesDailyRowDto], description: '按天聚合的销售明细' })
  dailySales: SalesDailyRowDto[];
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
