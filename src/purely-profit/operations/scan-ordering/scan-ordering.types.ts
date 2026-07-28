import type { ScanOrderStatus } from '@prisma/client';

/** 扫码点餐金额汇总，所有字段均由后端计算并以元输出。 */
export interface ScanOrderingAmountSummary {
  /** 商品基础价合计。 */
  itemOriginalAmount: number;
  /** 规格加价合计。 */
  specificationExtraAmount: number;
  /** 商品级优惠。 */
  productDiscountAmount: number;
  /** 订单级优惠。 */
  orderDiscountAmount: number;
  /** 税费。 */
  taxAmount: number;
  /** 服务费。 */
  serviceFeeAmount: number;
  /** 应付金额。 */
  payableAmount: number;
  /** 已支付金额。 */
  paidAmount: number;
  /** 待支付金额。 */
  outstandingAmount: number;
  /** 币种。 */
  currency: 'CNY';
}

/** 商家扫码点餐首页看板。 */
export interface ScanOrderingDashboardResponse {
  /** 营业日期。 */
  businessDate: string;
  /** 已支付营业额。 */
  paidRevenue: number;
  /** 已支付订单数量。 */
  paidOrderCount: number;
  /** 待接单数量。 */
  pendingOrderCount: number;
  /** 制作中订单数量。 */
  preparingOrderCount: number;
  /** 桌台状态数量汇总。 */
  tableStatusSummary: Record<
    'empty' | 'dining' | 'clearing' | 'disabled',
    number
  >;
}

/** 商家订单列表项。 */
export interface ScanOrderingOrderListItem {
  /** 订单主键。 */
  id: number;
  /** 门店订单号。 */
  orderNo: string;
  /** 乐观锁版本。 */
  version: number;
  /** 订单商品摘要。 */
  itemSummary: string;
  /** 桌台名称。 */
  tableName: string;
  /** 订单状态。 */
  status: ScanOrderStatus;
  /** 创建时间。 */
  createdAt: string;
  /** 后端金额汇总。 */
  amountSummary: ScanOrderingAmountSummary;
  /** 首个商品图片 URL（用于订单卡片缩略图）。 */
  imageUrl: string | null;
}
