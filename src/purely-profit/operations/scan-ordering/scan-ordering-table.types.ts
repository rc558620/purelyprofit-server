import type { ScanOrderingQrCodeResponse } from './scan-ordering-qr.service';

/** 手工录入单轮次状态：清桌会话判定与前端 loadManualEntryOrders 口径一致
 * （含已完成，否则全部完结的手工单桌台会被误判为无轮次而无法清桌）。 */
export const MANUAL_ENTRY_ROUND_STATUSES = [
  'pending_acceptance',
  'preparing',
  'served',
  'completed',
] as const;

/** 商家桌台卡片响应，订单数由数据库聚合后返回。 */
export interface ScanOrderingTableResponse {
  /** 桌台主键。 */
  id: number;
  /** 桌台业务编号。 */
  tableCode: string;
  /** 桌台展示名称。 */
  name: string;
  /** 桌台状态。 */
  status: 'empty' | 'dining' | 'clearing' | 'disabled';
  /** 当前活跃订单数量。 */
  activeOrderCount: number;
  /** 当前就餐人数。 */
  guestCount: number;
  /** 当前活跃会话；空桌时为 null。 */
  activeSession: {
    /** 会话标识：扫码会话为数字 ID；纯录入轮次为「manual-session-{桌台ID}」合成 ID */
    id: number | string;
    startedAt: string;
    guestCount: number;
    status: 'active' | 'checked_out' | 'expired' | 'left';
  } | null;
  /** 当前活跃会话中的进行中订单。 */
  activeOrders: Array<{
    /** 订单标识：扫码订单为数字 ID；手工补录单为「manual-{销售记录ID}」合成 ID */
    id: number | string;
    orderNo: string;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    totalAmount: number;
    createdAt: string;
    /** 是否为手工补录单（录入订单补账，无扫码订单详情，需跳销售记录查看） */
    manualEntry?: boolean;
  }>;
  /** 清桌校验结果。 */
  clearability: {
    canClear: boolean;
    blockingOrderCount: number;
    reason: string | null;
  };
  /** 所属区域 ID。 */
  areaId: number | null;
  /** 所属区域名称。 */
  areaName: string | null;
  /** 桌台类型 ID。 */
  typeId: number | null;
  /** 桌台类型名称。 */
  typeName: string | null;
}

/** 新增桌台响应：额外携带自动生成的首个桌码。 */
export interface ScanOrderingCreatedTableResponse extends ScanOrderingTableResponse {
  qrCode: ScanOrderingQrCodeResponse;
}
