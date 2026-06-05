import { EmployeeShiftType, SalesPaymentMethod } from '@prisma/client';

export const SHIFT_TIME_FALLBACKS: Record<
  EmployeeShiftType,
  { startTime: string; endTime: string }
> = {
  [EmployeeShiftType.morning]: { startTime: '08:00', endTime: '14:00' },
  [EmployeeShiftType.nine_to_six]: { startTime: '09:00', endTime: '18:00' },
  [EmployeeShiftType.middle]: { startTime: '12:00', endTime: '18:00' },
  [EmployeeShiftType.late]: { startTime: '17:00', endTime: '23:00' },
  [EmployeeShiftType.full]: { startTime: '09:00', endTime: '21:00' },
  [EmployeeShiftType.custom]: { startTime: '', endTime: '' },
};

export const PAYMENT_METHOD_CONFIG: Record<
  SalesPaymentMethod,
  { label: string; color: string }
> = {
  [SalesPaymentMethod.cash]: { label: '现金', color: '#f59e0b' },
  [SalesPaymentMethod.wechat]: { label: '微信', color: '#22c55e' },
  [SalesPaymentMethod.alipay]: { label: '支付宝', color: '#1677ff' },
  [SalesPaymentMethod.card]: { label: '刷卡', color: '#8b5cf6' },
};

export const SHIFT_TYPE_LABELS: Partial<Record<EmployeeShiftType, string>> = {
  [EmployeeShiftType.morning]: '早班',
  [EmployeeShiftType.nine_to_six]: '行政班',
  [EmployeeShiftType.middle]: '中班',
  [EmployeeShiftType.late]: '晚班',
  [EmployeeShiftType.full]: '全天',
  [EmployeeShiftType.custom]: '自定义班次',
};

export const HANDOVER_NOTE_MAX_LENGTH = 500;
export const HANDOVER_ADDITIONAL_ITEM_NAME_MAX_LENGTH = 20;
export const HANDOVER_ADDITIONAL_VALUE_MAX_LENGTH = 200;
export const ORDER_ITEMS_LIMIT = 50;
export const SPACE_PREPAID_DEDUCTION_ITEM_NAME = '预付抵扣';
export const SPACE_RENEW_DEDUCTION_ITEM_NAME = '续费抵扣';
export const SPACE_REFUND_ITEM_NAME = '空间退款';
export const CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE =
  '当前班次不属于该收银员，暂不允许操作';
