export const NOTIFICATION_TYPE_VALUES = [
  'inventory',
  'finance',
  'membership',
  'marketing',
  'withdrawal',
  'employee',
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
  alertThreshold: number;
  updatedAt: Date;
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
