export type SalesRecordPeriodValue =
  | 'today'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'all'
  | 'custom_month'
  | 'custom_range';

export const SALES_RECORD_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'quarter',
  'year',
  'all',
  'custom_month',
  'custom_range',
] as const satisfies readonly SalesRecordPeriodValue[];

export type SalesPaymentMethodValue =
  | 'cash'
  | 'wechat'
  | 'alipay'
  | 'card'
  | 'other'
  | 'groupon_voucher';

export const SALES_PAYMENT_METHOD_VALUES = [
  'cash',
  'wechat',
  'alipay',
  'card',
  'other',
  'groupon_voucher',
] as const satisfies readonly SalesPaymentMethodValue[];

export type SalesCalcModeValue = 'profit' | 'business';

export const SALES_CALC_MODE_VALUES = [
  'profit',
  'business',
] as const satisfies readonly SalesCalcModeValue[];
