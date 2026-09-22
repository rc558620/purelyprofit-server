/**
 * 扫码点餐实时事件的协议类型（Redis 频道消息体 + 各事件的 payload 结构）。
 * 与 `scan-ordering-realtime.service.ts` 分离，避免服务文件被 payload 定义撑大。
 */

export type RealtimeEvent =
  | 'order.created'
  | 'order.status_changed'
  | 'service_call.created'
  | 'service_call.updated'
  | 'voucher_order.created'
  | 'voucher_order.confirmed'
  | 'voucher_order.status_changed'
  | 'self_order.created'
  | 'self_order.status_changed';

/** Redis 频道内传输的实时消息体（JSON 序列化后的形状）。 */
export interface RealtimeMessage {
  event: RealtimeEvent;
  payload: Record<string, unknown>;
}

/** 取餐号状态（与门店取餐设置一致）。 */
export type RealtimePickupNumberStatus =
  | 'assigned'
  | 'called'
  | 'completed'
  | 'cancelled'
  | null;

/** 取餐号相关字段，订单创建/状态变更事件共用。 */
export interface RealtimePickupFields {
  /** 取餐号（新增可选字段，兼容旧客户端）。 */
  pickupNumber?: number | null;
  pickupNumberLabel?: string | null;
  pickupNumberStatus?: RealtimePickupNumberStatus;
  pickupCalledAt?: string | null;
  pickupCompletedAt?: string | null;
  /** 门店语音播报开关只读快照（后端门店配置为准，C 端据此决定是否弹取餐通知）。 */
  pickupVoiceEnabled?: boolean;
}

/** 扫码点餐订单状态变更事件。 */
export interface OrderStatusChangedPayload extends RealtimePickupFields {
  storeId: number;
  orderId: number;
  sessionId: number | null;
  /** 订单乐观锁版本；状态变更事件提供，历史兼容事件可不提供。 */
  version?: number;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  refundSucceededAt?: string | null;
}

/** 扫码点餐订单创建事件。 */
export interface OrderCreatedPayload extends RealtimePickupFields {
  storeId: number;
  orderId: number;
  sessionId: number | null;
  /** 订单乐观锁版本；创建事件可不提供，状态变更事件会提供真实版本。 */
  version?: number;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
}

/** 团购券新订单创建（purelyClub 支付成功后广播，商家端全局通知）。 */
export interface VoucherOrderCreatedPayload {
  /** 门店 ID */
  storeId: number;
  /** 业务订单号 */
  orderNo: string;
  /** 团购券码 */
  voucherCode: string;
  /** 顾客姓名 */
  guestName: string | null;
  /** 客人电话 */
  guestPhone: string | null;
  /** 商品名称 */
  productName: string;
  /** 商品分类名（团购券类型，如小包/中包） */
  categoryName: string | null;
  /** 购买数量 */
  quantity: number;
  /** 实付金额（分，商家端通知展示「金额：¥xx」） */
  paidAmountFen: number;
  /** 下单备注（用户购买时填写，可为空） */
  remark: string | null;
  /** 下单时间 ISO */
  createdAt: string;
}

/** 团购券订单商家确认（仅记录确认信息，不改变订单状态）。 */
export interface VoucherOrderConfirmedPayload {
  /** 门店 ID */
  storeId: number;
  /** 业务订单号 */
  orderNo: string;
  /** 确认时间 ISO */
  confirmedAt: string;
  /** 确认操作员姓名 */
  confirmedByStaffName: string;
}

/** 团购券订单状态变更（开台核销 used / 商家拒绝退款 refunded）。 */
export interface VoucherOrderStatusChangedPayload {
  /** 门店 ID */
  storeId: number;
  /** 业务订单号 */
  orderNo: string;
  /** 团购券码 */
  voucherCode: string;
  /** 新状态（used=开台核销 refunded=商家拒绝退款） */
  status: 'used' | 'refunded';
  /** 使用时间 ISO */
  usedAt?: string;
  /** 使用门店名称 */
  usedStoreName?: string;
  /** 退款时间 ISO（status=refunded 时携带） */
  refundAt?: string;
  /** 拒绝时间 ISO（商家拒绝退款时携带） */
  rejectedAt?: string;
  /** 拒绝操作员姓名（商家拒绝退款时携带） */
  rejectedByStaffName?: string | null;
}

/** 服务呼叫创建事件。 */
export interface ServiceCallCreatedPayload {
  storeId: number;
  sessionId: number;
  serviceCallId: number;
  type: string;
  remark: string | null;
}

/** 服务呼叫状态更新事件。 */
export interface ServiceCallUpdatedPayload {
  storeId: number;
  sessionId: number;
  serviceCallId: number;
  status: string;
}

/** 自助下单新订单（purelyClub 支付成功后广播，商家端右下角弹窗）。 */
export interface SelfOrderCreatedPayload {
  /** 门店 ID */
  storeId: number;
  /** 订单 ID */
  orderId: number;
  /** 业务订单号（SF 前缀） */
  orderNo: string;
  /** 空间会话 ID（商家端点击跳转空间详情） */
  sessionId: number;
  /** 空间 ID */
  spaceId: number;
  /** 空间名称 */
  spaceName: string;
  /** 商品行摘要 */
  items: Array<{ productName: string; quantity: number }>;
  /** 应付金额（分） */
  amountFen: number;
  /** 订单备注 */
  remark: string | null;
  /** 支付时间 ISO */
  paidAt: string;
}

/** 自助下单订单状态变更（当前仅支付成功与取消两种）。 */
export interface SelfOrderStatusChangedPayload {
  storeId: number;
  orderId: number;
  orderNo: string;
  sessionId: number;
  spaceId: number;
  status: string;
  paymentStatus: string;
  version: number;
}

/** 各事件对应的 payload 类型映射。 */
export interface RealtimeEventPayloadMap {
  'order.created': OrderCreatedPayload;
  'order.status_changed': OrderStatusChangedPayload;
  'service_call.created': ServiceCallCreatedPayload;
  'service_call.updated': ServiceCallUpdatedPayload;
  'voucher_order.created': VoucherOrderCreatedPayload;
  'voucher_order.confirmed': VoucherOrderConfirmedPayload;
  'voucher_order.status_changed': VoucherOrderStatusChangedPayload;
  'self_order.created': SelfOrderCreatedPayload;
  'self_order.status_changed': SelfOrderStatusChangedPayload;
}
