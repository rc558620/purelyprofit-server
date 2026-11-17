/**
 * 扫码点餐 Socket 会话与订阅消息的协议类型。
 * 与 gateway / 鉴权 service / 订阅 service 分离，避免实现文件被类型定义撑大。
 */
import type { AuthenticatedMembership } from '../../purely-profit/access-control/access-control.service';

/** 握手鉴权通过后挂在 `socket.data.identity` 上的最小身份快照。 */
export interface SocketIdentity {
  userId: number;
  email: string;
  phone: string;
  currentMembership: AuthenticatedMembership | null;
}

/** 订阅单个订单实时事件。 */
export interface JoinOrderPayload {
  orderId: number;
}

/** 订阅扫码点餐会话实时事件。 */
export interface JoinSessionPayload {
  sessionId: number;
}

/** 订阅门店维度实时事件。 */
export interface JoinStorePayload {
  storeId: number;
}

/** 订阅团购券订单核销/退款实时状态。 */
export interface JoinVoucherOrderPayload {
  orderNo: string;
}

/** 订单 / 会话 / 团购券订单房间的统一订阅结果。 */
export interface JoinRoomResult {
  room: string;
}

/** 门店维度房间的订阅结果，回带 storeId 便于客户端确认命中的门店。 */
export interface JoinStoreRoomResult extends JoinRoomResult {
  storeId: number;
}
