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

/** 团购券顾客支付方式标识（SpaceCustomerPaymentMethodValue，不在 SalesPaymentMethod 枚举内） */
export const GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD = 'groupon_voucher';
/** 团购券显示配置：用于开台项顾客实际支付方式为团购时的 label/color 覆盖 */
export const GROUPON_VOUCHER_DISPLAY = { label: '团购', color: '#b45309' };

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
export const ORDER_ITEMS_LIMIT = 999;
export const SPACE_PREPAID_DEDUCTION_ITEM_NAME = '预付款';
/** 兼容历史数据中 productName = '预付抵扣' 的旧值 */
export const SPACE_PREPAID_DEDUCTION_LEGACY_NAME = '预付抵扣';
export const SPACE_RENEW_DEDUCTION_ITEM_NAME = '续费抵扣';
export const SPACE_REFUND_ITEM_NAME = '空间退款';
export const SPACE_GUEST_PAYABLE_ITEM_NAME = '客人应付';
export const SPACE_GUEST_PAYABLE_COLOR = '#f43f5e';

/** 判断 productName 是否为预付款项（兼容新旧名称） */
export const isPrepaidDeductionItem = (productName: string): boolean =>
  productName === SPACE_PREPAID_DEDUCTION_ITEM_NAME ||
  productName === SPACE_PREPAID_DEDUCTION_LEGACY_NAME;

/** 判断 productName 是否为开台项（预付款 / 台位费），用于团购显示覆盖 */
export const isSessionStartItem = (productName: string): boolean =>
  isPrepaidDeductionItem(productName) || productName.includes('台位费');
export const CASHIER_SHIFT_OPERATION_BLOCK_MESSAGE =
  '当前班次不属于该收银员，暂不允许操作';

/** 交班销售记录时间分类：标识该行的时间语义 */
export const HandoverTimeCategory = {
  /** 开台：预付款 / 台位费 */
  SESSION_START: 'session_start',
  /** 续费：续费抵扣 */
  SESSION_RENEW: 'session_renew',
  /** 结账：客人应付 / 退款 */
  SESSION_END: 'session_end',
} as const;

export type HandoverTimeCategory =
  (typeof HandoverTimeCategory)[keyof typeof HandoverTimeCategory];

/** 根据 productName + paymentLabel 判断时间分类 */
export const resolveTimeCategory = (
  productName: string,
  paymentLabel: string,
): HandoverTimeCategory | null => {
  // 开台：预付款 / 台位费
  if (isPrepaidDeductionItem(productName) || productName.includes('台位费')) {
    return HandoverTimeCategory.SESSION_START;
  }
  // 续费：续费抵扣
  if (productName === SPACE_RENEW_DEDUCTION_ITEM_NAME) {
    return HandoverTimeCategory.SESSION_RENEW;
  }
  // 结账：客人应付 / 退款
  if (productName.includes('客人应付') || paymentLabel.includes('退款')) {
    return HandoverTimeCategory.SESSION_END;
  }
  return null;
};
