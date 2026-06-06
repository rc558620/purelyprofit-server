import {
  EmployeeShiftType,
  Prisma,
  SalesPaymentMethod,
  SpaceSessionStatus,
} from '@prisma/client';
import type { HandoverShiftInfoDto } from './dto/handover-page.dto';
import type {
  HandoverOrderItemDto,
  HandoverPaymentItemDto,
} from './dto/handover-shared.dto';
import {
  ORDER_ITEMS_LIMIT,
  PAYMENT_METHOD_CONFIG,
  SHIFT_TIME_FALLBACKS,
  SPACE_PREPAID_DEDUCTION_ITEM_NAME,
  SPACE_RENEW_DEDUCTION_ITEM_NAME,
  buildShiftDateRange,
  type DisplayOperatorInfo,
  type OrderItemRow,
  type RefundOrderRow,
  type ShiftRecordRow,
  mapOrderItem,
  mapRefundOrderItem,
  resolveOrderItemPaymentMethod,
  resolveShiftLabel,
  roundMoney,
  toDisplayName,
  toMoneyNumber,
} from './handover.shared';
import type { HandoverRecordListItemDto } from './dto/handover-records.dto';

export const SALE_ORDER_ITEM_SELECT = {
  id: true,
  productName: true,
  salePrice: true,
  quantity: true,
  product: {
    select: {
      stock: true,
      unit: true,
    },
  },
  order: {
    select: {
      id: true,
      date: true,
      paymentMethod: true,
      spaceSession: {
        select: {
          prepaidPaymentMethod: true,
          renewRecords: true,
        },
      },
    },
  },
} satisfies Prisma.SaleOrderItemSelect;

export type ShiftRangeLike = {
  startAt: Date;
  endAt: Date;
};

export const buildShiftInfo = (params: {
  shiftType: HandoverShiftInfoDto['shiftType'];
  shiftName: HandoverShiftInfoDto['shiftName'];
  shiftLabel: HandoverShiftInfoDto['shiftLabel'];
  startTime: string;
  endTime: string;
  operatorName: string;
  shiftDate?: Date;
  operatorAvatar?: string;
}): HandoverShiftInfoDto => {
  const shiftReferenceTime = buildShiftDateRange(
    params.startTime,
    params.endTime,
    params.shiftDate ?? new Date(),
  ).startAt;

  return {
    shiftType: params.shiftType,
    shiftName: params.shiftName,
    shiftLabel: params.shiftLabel,
    startTime: params.startTime,
    endTime: params.endTime,
    operatorName: params.operatorName,
    ...(params.operatorAvatar
      ? {
          operatorAvatar: params.operatorAvatar,
          avatar: params.operatorAvatar,
        }
      : {}),
    shiftReferenceAt: shiftReferenceTime.getTime(),
  };
};

export const buildPageShiftInfo = (params: {
  userName?: string | null;
  shiftRecord: ShiftRecordRow | null;
  shiftType: EmployeeShiftType;
  displayOperatorInfo: DisplayOperatorInfo;
  requestedOperatorName?: string;
}): HandoverShiftInfoDto => {
  const {
    displayOperatorInfo,
    requestedOperatorName,
    shiftRecord,
    shiftType,
    userName,
  } = params;
  const fallbackTime = SHIFT_TIME_FALLBACKS[shiftType];
  const operatorName =
    toDisplayName(shiftRecord?.employeeName) ??
    displayOperatorInfo.name ??
    toDisplayName(requestedOperatorName) ??
    toDisplayName(userName) ??
    '当前员工';

  const shiftName =
    toDisplayName(shiftRecord?.shiftName) ??
    resolveShiftLabel(shiftType, shiftRecord?.shiftName);

  return buildShiftInfo({
    shiftType,
    shiftName,
    shiftLabel: shiftName,
    startTime: shiftRecord?.startTime ?? fallbackTime.startTime,
    endTime: shiftRecord?.endTime ?? fallbackTime.endTime,
    operatorName,
    shiftDate: shiftRecord?.date,
    operatorAvatar: displayOperatorInfo.avatar,
  });
};

export const buildSaleOrderWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
  operatorStaffId: number | null,
): Prisma.SaleOrderWhereInput => ({
  storeId,
  date: {
    gte: shiftRange.startAt,
    lte: shiftRange.endAt,
  },
  ...(operatorStaffId ? { operatorStaffId } : {}),
});

export const buildCashFlowWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
  operatorStaffId: number | null,
): Prisma.FinanceCashFlowRecordWhereInput => ({
  storeId,
  date: {
    gte: shiftRange.startAt,
    lte: shiftRange.endAt,
  },
  ...(operatorStaffId ? { operatorStaffId } : {}),
});

export const buildSpaceRefundOrderWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
): Prisma.SaleOrderWhereInput => ({
  storeId,
  totalRevenue: {
    lt: 0,
  },
  spaceSession: {
    is: {
      status: SpaceSessionStatus.settled,
      endTime: {
        gte: shiftRange.startAt,
        lte: shiftRange.endAt,
      },
    },
  },
});

export const mergeDisplayedOrderItems = (
  orderItems: OrderItemRow[],
  refundOrders: RefundOrderRow[],
): HandoverOrderItemDto[] => {
  const merged = [
    ...refundOrders.map((order) => mapRefundOrderItem(order)),
    ...orderItems.map((item) => mapOrderItem(item)),
  ];

  return merged
    .sort((left, right) => {
      if (right.date !== left.date) {
        return right.date - left.date;
      }
      const leftIsRefund = left.id.startsWith('refund-order-');
      const rightIsRefund = right.id.startsWith('refund-order-');
      if (leftIsRefund !== rightIsRefund) {
        return rightIsRefund ? 1 : -1;
      }
      return right.id.localeCompare(left.id);
    })
    .slice(0, ORDER_ITEMS_LIMIT);
};

export const mapPaymentItems = (
  items: OrderItemRow[],
): HandoverPaymentItemDto[] => {
  const paymentAmountMap = new Map<SalesPaymentMethod, number>();

  for (const item of items) {
    const rawAmount = roundMoney(toMoneyNumber(item.salePrice) * item.quantity);
    const amount =
      rawAmount > 0 ||
      item.productName === SPACE_PREPAID_DEDUCTION_ITEM_NAME ||
      item.productName === SPACE_RENEW_DEDUCTION_ITEM_NAME
        ? Math.abs(rawAmount)
        : 0;
    if (amount <= 0) {
      continue;
    }

    const paymentMethod = resolveOrderItemPaymentMethod(item);
    paymentAmountMap.set(
      paymentMethod,
      roundMoney((paymentAmountMap.get(paymentMethod) ?? 0) + amount),
    );
  }

  return Array.from(paymentAmountMap.entries()).map(([method, amount]) => ({
    method,
    label: PAYMENT_METHOD_CONFIG[method].label,
    amount,
    ratio: 0,
    color: PAYMENT_METHOD_CONFIG[method].color,
  }));
};

export const attachPaymentRatios = (
  items: HandoverPaymentItemDto[],
  totalRevenue: number,
): HandoverPaymentItemDto[] =>
  items.map((item) => ({
    ...item,
    ratio: totalRevenue > 0 ? roundMoney(item.amount / totalRevenue) : 0,
  }));

export const sumPaymentAmounts = (items: HandoverPaymentItemDto[]): number =>
  roundMoney(items.reduce((sum, item) => sum + item.amount, 0));

export const buildRevenueAmounts = (
  spaceRevenue: Prisma.Decimal | number | string | null | undefined,
  additionalRevenue: Prisma.Decimal | number | string | null | undefined,
  refundRevenue: Prisma.Decimal | number | string | null | undefined,
): {
  additionalRevenueAmount: number;
  spaceRevenueAmount: number;
  refundAmount: number;
} => ({
  additionalRevenueAmount: toMoneyNumber(additionalRevenue),
  spaceRevenueAmount: toMoneyNumber(spaceRevenue),
  refundAmount: Math.abs(toMoneyNumber(refundRevenue)),
});

export const buildRecordRevenueSummary = (
  revenueAmounts: ReturnType<typeof buildRevenueAmounts>,
  orderCount: number,
  pettyCashAmount: number,
): NonNullable<HandoverRecordListItemDto['revenueSummary']> => ({
  additionalRevenue: revenueAmounts.additionalRevenueAmount,
  spaceRevenue: revenueAmounts.spaceRevenueAmount,
  refundAmount: revenueAmounts.refundAmount,
  totalRevenue: roundMoney(
    revenueAmounts.additionalRevenueAmount +
      revenueAmounts.spaceRevenueAmount -
      revenueAmounts.refundAmount,
  ),
  orderCount,
  pettyCache: pettyCashAmount,
});
