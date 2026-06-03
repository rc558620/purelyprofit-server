export const SPACE_COUNTDOWN_FEE_MODE_VALUES = ['timed', 'fixed'] as const;
export type SpaceCountdownFeeModeValue =
  (typeof SPACE_COUNTDOWN_FEE_MODE_VALUES)[number];

export const SPACE_TIME_FEE_MODE_VALUES = ['timed', 'unit_price'] as const;
export type SpaceTimeFeeModeValue = (typeof SPACE_TIME_FEE_MODE_VALUES)[number];

export const SPACE_SESSION_CONTACT_PATTERN = /^[0-9+\-\s]{6,20}$/;

export const SPACE_CUSTOMER_PAYMENT_METHOD_VALUES = [
  'cash',
  'wechat',
  'alipay',
  'card',
  'groupon_voucher',
] as const;
export type SpaceCustomerPaymentMethodValue =
  (typeof SPACE_CUSTOMER_PAYMENT_METHOD_VALUES)[number];

export const SPACE_SETTLEMENT_CHANNEL_VALUES = [
  'direct_cashier',
  'meituan_groupon',
  'douyin_groupon',
  'other_platform',
] as const;
export type SpaceSettlementChannelValue =
  (typeof SPACE_SETTLEMENT_CHANNEL_VALUES)[number];

export const SPACE_SETTLEMENT_STATUS_VALUES = [
  'not_applicable',
  'pending',
  'partially_settled',
  'settled',
  'cancelled',
] as const;
export type SpaceSettlementStatusValue =
  (typeof SPACE_SETTLEMENT_STATUS_VALUES)[number];

export function transformOptionalBoolean({
  value,
}: {
  value: unknown;
}): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }
  }

  return undefined;
}
