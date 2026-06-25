import {
  EmployeeShiftType,
  Prisma,
  SalesPaymentMethod,
  StaffRole,
} from '@prisma/client';
import type { HandoverAdditionalItemDto } from './dto/handover-additional-items.dto';
import {
  HandoverRecordDisplayStatusDto,
  HandoverStatusDto,
} from './dto/handover-shared.dto';
import type { HandoverOrderItemDto } from './dto/handover-shared.dto';
import type {
  HandoverRecordDetailAdditionalItemDto,
  HandoverRecordListItemDto,
  HandoverRecordSummaryDto,
} from './dto/handover-records.dto';
import {
  PAYMENT_METHOD_CONFIG,
  SHIFT_TYPE_LABELS,
  SPACE_PREPAID_DEDUCTION_ITEM_NAME,
  SPACE_REFUND_ITEM_NAME,
  SPACE_RENEW_DEDUCTION_ITEM_NAME,
} from './handover.constants';
import type {
  AdditionalItemRow,
  HandoverRecordRow,
  OrderItemRow,
  RefundOrderRow,
} from './handover.types';
import { mulMoney, toDisplayName, toMoneyNumber } from './handover.utils';

const FALLBACK_ORDER_OPERATOR_NAME = '当前操作员';
const AUTO_SETTLEMENT_OPERATOR_NAME = '空间自动结账';

const SALES_PAYMENT_METHOD_VALUES = new Set(Object.values(SalesPaymentMethod));

const isSalesPaymentMethod = (value: unknown): value is SalesPaymentMethod =>
  typeof value === 'string' &&
  SALES_PAYMENT_METHOD_VALUES.has(value as SalesPaymentMethod);

const parseRenewPaymentMethods = (
  renewRecords: Prisma.JsonValue,
): SalesPaymentMethod[] => {
  if (!Array.isArray(renewRecords)) {
    return [];
  }

  return renewRecords.flatMap((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return [];
    }

    const paymentMethod = (record as { paymentMethod?: unknown }).paymentMethod;
    return isSalesPaymentMethod(paymentMethod) ? [paymentMethod] : [];
  });
};

const shouldPrefixSpaceName = (productName: string): boolean =>
  productName === SPACE_PREPAID_DEDUCTION_ITEM_NAME ||
  productName.startsWith('台位费（');

const resolveOrderItemProductName = (item: OrderItemRow): string => {
  const spaceName = toDisplayName(item.order.spaceSession?.space?.name);
  if (!spaceName || !shouldPrefixSpaceName(item.productName)) {
    return item.productName;
  }

  return `${spaceName}${item.productName}`;
};

export const resolveOrderItemPaymentMethod = (
  item: OrderItemRow,
): SalesPaymentMethod => {
  const fallbackPaymentMethod = item.order.paymentMethod;
  const spaceSession = item.order.spaceSession;

  if (!spaceSession) {
    return fallbackPaymentMethod;
  }

  if (
    item.productName === SPACE_PREPAID_DEDUCTION_ITEM_NAME &&
    spaceSession.prepaidPaymentMethod
  ) {
    return spaceSession.prepaidPaymentMethod;
  }

  if (item.productName !== SPACE_RENEW_DEDUCTION_ITEM_NAME) {
    return fallbackPaymentMethod;
  }

  const renewPaymentMethods = [
    ...new Set(parseRenewPaymentMethods(spaceSession.renewRecords)),
  ];

  return renewPaymentMethods.length === 1
    ? renewPaymentMethods[0]
    : fallbackPaymentMethod;
};

/**
 * 解析操作员的真实角色：
 * 优先使用 Staff.role（OWNER 直接可信），
 * 否则检查关联的 StoreSubAccount.role（manager → MANAGER）。
 */
const resolveOperatorRole = (
  staff: {
    role: StaffRole;
    employeeProfile: {
      subAccounts: { role: string }[];
    } | null;
  } | null,
): StaffRole | null => {
  if (!staff) return null;
  if (staff.role === StaffRole.OWNER) return StaffRole.OWNER;
  const subAccountRole = staff.employeeProfile?.subAccounts[0]?.role;
  if (subAccountRole === 'manager') return StaffRole.MANAGER;
  return staff.role;
};

export const mapOrderItem = (item: OrderItemRow): HandoverOrderItemDto => {
  const totalRevenue = mulMoney(toMoneyNumber(item.salePrice), item.quantity);
  const paymentMethod = resolveOrderItemPaymentMethod(item);
  return {
    id: String(item.id),
    productName: resolveOrderItemProductName(item),
    quantity: item.quantity,
    totalRevenue,
    paymentLabel: PAYMENT_METHOD_CONFIG[paymentMethod].label,
    paymentColor: PAYMENT_METHOD_CONFIG[paymentMethod].color,
    operatorName:
      toDisplayName(item.order.operatorNameSnapshot) ??
      toDisplayName(item.order.operatorStaff?.name) ??
      FALLBACK_ORDER_OPERATOR_NAME,
    operatorRole: resolveOperatorRole(item.order.operatorStaff),
    date: item.order.date.getTime(),
    currentStock: item.product?.stock ?? null,
    stockUnit: item.product?.unit ?? null,
  };
};

export const mapRefundOrderItem = (
  order: RefundOrderRow,
): HandoverOrderItemDto => ({
  id: `refund-order-${order.id}`,
  productName: order.spaceSession?.space.name ?? SPACE_REFUND_ITEM_NAME,
  quantity: 1,
  totalRevenue: toMoneyNumber(order.totalRevenue),
  paymentLabel: `${PAYMENT_METHOD_CONFIG[order.paymentMethod].label}退款`,
  paymentColor: PAYMENT_METHOD_CONFIG[order.paymentMethod].color,
  operatorName:
    toDisplayName(order.operatorNameSnapshot) ??
    toDisplayName(order.operatorStaff?.name) ??
    AUTO_SETTLEMENT_OPERATOR_NAME,
  operatorRole: resolveOperatorRole(order.operatorStaff),
  date: order.date.getTime(),
  currentStock: null,
  stockUnit: null,
});

export const mapAdditionalItem = (
  item: AdditionalItemRow,
): HandoverAdditionalItemDto => ({
  id: item.id,
  name: item.name,
  val: item.val ?? '',
  createdAt: item.createdAt.getTime(),
  updatedAt: item.updatedAt.getTime(),
});

export const resolveShiftLabel = (
  shiftType: EmployeeShiftType | null | undefined,
  shiftName?: string | null,
): string => {
  const normalizedShiftName = toDisplayName(shiftName);
  if (normalizedShiftName) {
    return normalizedShiftName;
  }
  if (shiftType) {
    return SHIFT_TYPE_LABELS[shiftType] ?? '未知班次';
  }
  return '未排班';
};

export const formatMonthDay = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${month}-${day}`;
};

export const formatShiftTimeDesc = (
  date: Date,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): string => {
  const monthDay = formatMonthDay(date);
  if (!startTime || !endTime) {
    return `${monthDay}  未排班`;
  }
  return `${monthDay}  ${startTime}–${endTime}`;
};

export const mapRecordDisplayStatus = (
  status: HandoverStatusDto,
): HandoverRecordDisplayStatusDto =>
  status === HandoverStatusDto.PENDING
    ? HandoverRecordDisplayStatusDto.ACTIVE
    : HandoverRecordDisplayStatusDto.DONE;

export const buildRecordSummaryDto = (params: {
  id: number;
  operatorName: string;
  operatorAvatar?: string | null;
  shiftType: EmployeeShiftType | null;
  shiftLabel: string;
  startTime: string | null;
  endTime: string | null;
  totalRevenue: number;
  status: HandoverStatusDto;
  handoverAt: Date | null;
  createdAt: Date;
  shiftDate?: Date | null;
}): HandoverRecordSummaryDto => {
  const referenceDate =
    params.shiftDate ?? params.handoverAt ?? params.createdAt;
  return {
    id: params.id,
    operatorName: params.operatorName,
    ...(params.operatorAvatar
      ? {
          operatorAvatar: params.operatorAvatar,
          avatar: params.operatorAvatar,
        }
      : {}),
    shiftType: params.shiftType,
    shiftLabel: params.shiftLabel,
    startTime: params.startTime,
    endTime: params.endTime,
    timeDesc: formatShiftTimeDesc(
      referenceDate,
      params.startTime,
      params.endTime,
    ),
    totalRevenue: params.totalRevenue,
    status: params.status,
    displayStatus: mapRecordDisplayStatus(params.status),
    handoverAt: params.handoverAt?.getTime() ?? null,
    createdAt: params.createdAt.getTime(),
    shiftReferenceAt: referenceDate.getTime(),
  };
};

export const mapRecordAdditionalItems = (
  record: HandoverRecordRow,
): HandoverRecordDetailAdditionalItemDto[] =>
  (record.additionalValues ?? []).map((item) => ({
    id: item.id,
    itemId: item.itemId,
    itemName: item.item.name,
    value: item.value,
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
  }));

export const mapRecordToDto = (
  record: HandoverRecordRow,
  detail?: Pick<
    HandoverRecordListItemDto,
    | 'shiftInfo'
    | 'additionalItems'
    | 'revenueSummary'
    | 'paymentItems'
    | 'orderItems'
    | 'receiverName'
  >,
): HandoverRecordListItemDto => ({
  id: record.id,
  handoverMode: record.handoverMode,
  status: record.status,
  fromEmployeeId: record.fromEmployeeId,
  fromEmployeeName:
    record.fromEmployee?.name ?? record.fromEmployeeNameSnapshot ?? null,
  toEmployeeId: record.toEmployeeId,
  toEmployeeName: record.toEmployee?.name ?? null,
  note: record.note,
  reason: record.reason,
  handoverAt: record.handoverAt?.getTime() ?? null,
  createdAt: record.createdAt.getTime(),
  updatedAt: record.updatedAt.getTime(),
  shiftInfo: detail?.shiftInfo ?? null,
  additionalItems: detail?.additionalItems ?? mapRecordAdditionalItems(record),
  ...(detail?.revenueSummary ? { revenueSummary: detail.revenueSummary } : {}),
  ...(detail?.paymentItems ? { paymentItems: detail.paymentItems } : {}),
  ...(detail?.orderItems ? { orderItems: detail.orderItems } : {}),
  ...(detail?.receiverName !== undefined
    ? { receiverName: detail.receiverName }
    : {}),
});
