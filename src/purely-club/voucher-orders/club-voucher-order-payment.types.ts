// 团购券订单支付链路：共享类型与常量（service / helper 共用，避免彼此循环依赖）
import type { ClubVoucherOrderStatusValue } from './club-voucher-orders.types';

/** 券码唯一冲突重试次数（唯一索引兜底，碰撞概率极低） */
export const VOUCHER_CODE_RETRY_TIMES = 3;

/** 团购券订单状态字面量：复用领域状态值联合 */
export type VoucherOrderStatus = ClubVoucherOrderStatusValue;

/** 团购券订单草稿（unpaid）→ 响应结构 */
export interface ClubVoucherOrderDraftView {
  id: string;
  orderNo: string;
  status: VoucherOrderStatus;
  /** 支付成功后的团购券码 */
  voucherCode: string | null;
  amountFen: number;
  paymentParams?: {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: string;
    paySign: string;
  };
}

/** 订单实体 → 草稿视图映射所需字段 */
export interface VoucherOrderDraftRow {
  orderNo: string;
  status: VoucherOrderStatus;
  voucherCode: string | null;
  paidAmountFen: number;
}

/** 余额支付结算所需订单字段 */
export interface VoucherBalanceSettlementOrder {
  storeId: number;
  orderNo: string;
  productName: string;
  /** 实付金额（分） */
  paidAmountFen: number;
  /** 积分抵扣金额（分） */
  pointsDeductFen: number;
  /** 实际扣减积分个数 */
  pointsUsed: number;
}

/** 支付完成后广播新订单事件所需的订单快照 */
export interface PaidVoucherOrderSnapshot {
  storeId: number;
  orderNo: string;
  voucherCode: string;
  guestName: string | null;
  guestPhone: string | null;
  productName: string;
  categoryName: string | null;
  quantity: number;
  /** 实付金额（分） */
  paidAmountFen: number;
  /** 下单备注（可空） */
  remark: string | null;
  createdAt: Date;
}
