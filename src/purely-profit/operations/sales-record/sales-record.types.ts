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

/**
 * 录单来源：会员过期后据此施加禁用限制。
 *
 * 只保留 `additional`（追加点单）。手动录单不走本接口的 source 语义——
 * 录入订单由 scan-ordering 的独立接口建单，额度在那边原子预占，
 * 订单是否属于 `#M-` 手工补录号段由服务端按入口决定，不需要调用方声明。
 */
export type SalesRecordSourceValue = 'additional';

export const SALES_RECORD_SOURCE_VALUES = [
  'additional',
] as const satisfies readonly SalesRecordSourceValue[];
