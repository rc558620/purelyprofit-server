export const CLUB_ORDER_TYPE_VALUES = ['recharge', 'service'] as const;
export type ClubOrderTypeValue = (typeof CLUB_ORDER_TYPE_VALUES)[number];

export const CLUB_ORDER_STATUS_VALUES = [
  'pending',
  'paid',
  'failed',
  'cancelled',
  'expired',
] as const;
export type ClubOrderStatusValue = (typeof CLUB_ORDER_STATUS_VALUES)[number];

export const CLUB_ORDER_PAYMENT_CHANNEL_VALUES = ['wechat'] as const;
export type ClubOrderPaymentChannelValue =
  (typeof CLUB_ORDER_PAYMENT_CHANNEL_VALUES)[number];

export const CLUB_ORDER_PAYMENT_CONFIRMATION_SOURCE_VALUES = [
  'wechat_callback',
  'manual_confirm_paid',
] as const;
export type ClubOrderPaymentConfirmationSourceValue =
  (typeof CLUB_ORDER_PAYMENT_CONFIRMATION_SOURCE_VALUES)[number];
