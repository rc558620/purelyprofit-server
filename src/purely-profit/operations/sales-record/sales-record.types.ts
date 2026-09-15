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
  | 'groupon_voucher'
  | 'platform';

export const SALES_PAYMENT_METHOD_VALUES = [
  'cash',
  'wechat',
  'alipay',
  'card',
  'other',
  'groupon_voucher',
  'platform',
] as const satisfies readonly SalesPaymentMethodValue[];

export type SalesCalcModeValue = 'profit' | 'business';

export const SALES_CALC_MODE_VALUES = [
  'profit',
  'business',
] as const satisfies readonly SalesCalcModeValue[];

/** 录单来源；会员过期后对 additional / manual_entry 施加不同限制 */
export type SalesRecordSourceValue = 'additional' | 'manual_entry';

export const SALES_RECORD_SOURCE_VALUES = [
  'additional',
  'manual_entry',
] as const satisfies readonly SalesRecordSourceValue[];
