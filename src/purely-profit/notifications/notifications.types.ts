export const NOTIFICATION_TYPE_VALUES = [
  'inventory',
  'finance',
  'membership',
  'marketing',
  'withdrawal',
  'employee',
  'custody',
] as const;

export type NotificationTypeValue = (typeof NOTIFICATION_TYPE_VALUES)[number];

export interface NotificationsStoreQueryInput {
  storeId?: number;
}

export interface ListNotificationsQueryInput {
  storeId?: number;
  page?: number;
  pageSize?: number;
  type?: NotificationTypeValue;
  unreadOnly?: boolean;
}

export interface ProductAlertRow {
  id: number;
  name: string;
  stock: number;
  alert_threshold: number;
  updated_at: Date;
}

export interface DecimalLike {
  toString(): string;
}

export interface OverdueAccountRow {
  id: number;
  counterpart: string;
  remaining: DecimalLike;
  dueDate: Date | null;
  updatedAt: Date;
}

export interface StoreSubscriptionRow {
  id: number;
  planName: string;
  status: string;
  expiresAt: Date | null;
  updatedAt: Date;
}

export interface ActivePromotionRow {
  id: number;
  name: string;
  endAt: Date;
  updatedAt: Date;
}

export interface PendingWithdrawalRow {
  id: number;
  beanAmount: number;
  appliedAt: Date;
}

export interface UpcomingLeaveRow {
  id: number;
  employeeName: string;
  startDate: Date;
  createdAt: Date;
}

/** 近期被作废的客存单（站内消息：作废是异常动作，需门店知晓） */
export interface VoidedCustodyOrderRow {
  id: number;
  orderNo: string;
  productName: string;
  voidReason: string | null;
  voidedAt: Date | null;
}

/** 近期核销汇总（站内消息：按天汇总，避免每笔取出都产生一条噪音） */
export interface CustodyPickupSummary {
  pickedCount: number;
  pickedQty: number;
  lastPickedAt: Date | null;
}

export interface NotificationDraft {
  id: string;
  type: NotificationTypeValue;
  title: string;
  content: string;
  bizType?: string;
  bizId?: string;
  actionUrl?: string;
  createdAt: number;
}

export interface NotificationListPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface NotificationListPageResult {
  items: NotificationDraft[];
  meta: NotificationListPageMeta;
}

export interface NotificationsContext {
  storeId: number;
  items: NotificationDraft[];
}

export type NotificationReadMap = Map<string, number | undefined>;
