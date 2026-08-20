import type {
  ScanOrderFulfillmentStatus,
  ScanOrderPaymentStatus,
  ScanOrderStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** 订单基础状态字段查询选择（推送快照共用）。 */
export const ORDER_STATUS_SELECT = {
  id: true,
  storeId: true,
  sessionId: true,
  status: true,
  paymentStatus: true,
  fulfillmentStatus: true,
} as const;

/** 商家拒单退款公共上下文。 */
export interface MerchantRejectContext {
  user: AuthenticatedUser;
  orderId: number;
  storeId: number;
  version: number;
  reason: string;
}

/** 订单最近一次成功支付尝试（退款任务所需信息）。 */
export interface RefundPaymentInfo {
  id: number | null;
  merchantPaymentNo: string | null;
  providerTransactionId: string | null;
}

/** 订单状态变更实时推送快照。 */
export interface OrderStatusSnapshot {
  id: number;
  storeId: number;
  sessionId: number | null;
  status: ScanOrderStatus;
  paymentStatus: ScanOrderPaymentStatus;
  fulfillmentStatus: ScanOrderFulfillmentStatus;
}

/** 退款完成后的订单推送快照（含取餐号与退款任务时间）。 */
export interface RefundedOrderSnapshot extends OrderStatusSnapshot {
  pickupNumber: number | null;
  refundTasks: Array<{
    refundSucceededAt: Date | null;
    processedAt: Date | null;
    triggeredAt: Date | null;
  }>;
}

/** 商家拒单退款流程上下文（含支付信息）。 */
export interface MerchantRefundFlowContext extends MerchantRejectContext {
  paidAmount: number;
  paymentAttempt: RefundPaymentInfo | null;
}

/** 支付渠道退款单号信息。 */
export interface RefundProviderInfo {
  refundNo?: string;
  refundId?: string;
}

/** 待接单订单退款中流转目标。 */
export type RefundTransitionTarget = RefundOrderTarget & {
  reason: string;
};

/** 订单乐观锁操作目标（状态流转 / 退款完成共用）。 */
export interface RefundOrderTarget {
  orderId: number;
  storeId: number;
  version: number;
}

/** 商家操作订单状态历史写入输入。 */
export interface OrderStatusHistoryInput extends RefundOrderTarget {
  fromStatus: ScanOrderStatus;
  toStatus: ScanOrderStatus;
  reason: string;
  operatorId?: number;
}

/** 退款完成收尾输入（标记退款任务成功 + 写状态历史）。 */
export interface RefundFinalizeInput extends RefundOrderTarget {
  operatorId?: number;
  /** 操作类型：merchant=商家 / system=系统超时自动退款 */
  operatorType?: string;
  provider?: RefundProviderInfo;
}

/** 系统超时自动退款输入（待接单超时 / 制作中超时共用）。 */
export interface SystemTimeoutRefundInput extends RefundOrderTarget {
  /** 退款前订单所处状态（pending_acceptance=超时未接单，preparing=超时未出餐）。 */
  fromStatus: Extract<ScanOrderStatus, 'pending_acceptance' | 'preparing'>;
  /** 退款原因文案。 */
  reason: string;
}
