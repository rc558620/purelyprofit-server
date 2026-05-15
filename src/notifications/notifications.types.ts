export const NOTIFICATION_TYPE_VALUES = [
  'inventory',
  'finance',
  'membership',
  'marketing',
  'withdrawal',
  'employee',
] as const;

export type NotificationTypeValue = (typeof NOTIFICATION_TYPE_VALUES)[number];
