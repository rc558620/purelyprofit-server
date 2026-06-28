import {
  EmployeeShiftType,
  Prisma,
  SalesPaymentMethod,
  SpaceSessionStatus,
} from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import type { HandoverShiftInfoDto } from './dto/handover-page.dto';
import type {
  HandoverOrderItemDto,
  HandoverPaymentItemDto,
} from './dto/handover-shared.dto';
import {
  ORDER_ITEMS_LIMIT,
  PAYMENT_METHOD_CONFIG,
  SHIFT_TIME_FALLBACKS,
  SPACE_GUEST_PAYABLE_COLOR,
  SPACE_GUEST_PAYABLE_ITEM_NAME,
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
  toDisplayName,
  dbCentsToOutputYuan,
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
      operatorNameSnapshot: true,
      operatorStaff: {
        select: {
          name: true,
          role: true,
          employeeProfile: {
            select: {
              subAccounts: {
                select: { role: true },
                take: 1,
              },
            },
          },
        },
      },
      spaceSession: {
        select: {
          prepaidPaymentMethod: true,
          sessionRenewRecords: {
            select: {
              paymentMethod: true,
            },
          },
          space: {
            select: {
              name: true,
            },
          },
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

/**
 * 构建 SaleOrder 查询条件：
 * 按门店和时间范围过滤，不按 operatorStaffId 过滤。
 * 这样任何账号（主账号/店长/收银员）在班次期间创建的销售都能显示在
 * 对应班次的交班页面上，操作员名称由 saleOrder.operatorStaff 关联展示。
 */
export const buildSaleOrderWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
): Prisma.SaleOrderWhereInput => {
  const dateFilter: Prisma.DateTimeFilter = {
    gte: shiftRange.startAt,
    lte: shiftRange.endAt,
  };

  return { storeId, date: dateFilter };
};

/**
 * 构建 additionalRevenue 统计的 SaleOrder 查询条件：
 * 仅统计常规销售单（spaceSession IS NULL），按门店和时间范围过滤。
 * 空间会话结账订单的收入统一由 spaceRevenue 统计，不在此处重复计算。
 */
export const buildNonSpaceSessionOrderWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
): Prisma.SaleOrderWhereInput => {
  const dateFilter: Prisma.DateTimeFilter = {
    gte: shiftRange.startAt,
    lte: shiftRange.endAt,
  };

  return {
    storeId,
    date: dateFilter,
    spaceSession: { is: null },
  };
};

/**
 * 构建 SaleOrderItem 查询条件：
 * 按门店和时间范围过滤，不按 operatorStaffId 过滤。
 */
export const buildSaleOrderItemOrderWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
): Prisma.SaleOrderItemWhereInput['order'] => {
  const dateFilter: Prisma.DateTimeFilter = {
    gte: shiftRange.startAt,
    lte: shiftRange.endAt,
  };

  return { storeId, date: dateFilter };
};

/**
 * 构建现金流水查询条件：
 * 按门店和时间范围过滤，不按 operatorStaffId 过滤。
 */
export const buildCashFlowWhere = (
  storeId: number,
  shiftRange: ShiftRangeLike,
): Prisma.FinanceCashFlowRecordWhereInput => {
  const dateFilter: Prisma.DateTimeFilter = {
    gte: shiftRange.startAt,
    lte: shiftRange.endAt,
  };

  return { storeId, date: dateFilter };
};

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

export const buildGuestPayableItems = (
  settledSessions: Array<{
    id: number;
    timeCost: number | null;
    itemsCost: number;
    prepaidAmount: number | null;
    endTime: Date | null;
    space: { name: string };
    saleOrder: {
      paymentMethod: SalesPaymentMethod;
      date: Date;
    } | null;
  }>,
): HandoverOrderItemDto[] => {
  const items: HandoverOrderItemDto[] = [];

  for (const session of settledSessions) {
    const consumptionCents =
      Money.fromDbCents(Number(session.timeCost ?? 0))
        .add(Money.fromDbCents(Number(session.itemsCost)))
        .toDbCents();
    const prepaidCents = Number(session.prepaidAmount ?? 0);
    if (consumptionCents <= prepaidCents) continue;

    const payableAmountCents = Money.fromDbCents(consumptionCents)
      .subtract(Money.fromDbCents(prepaidCents))
      .toDbCents();
    if (payableAmountCents <= 0) continue;

    const paymentMethod =
      session.saleOrder?.paymentMethod ?? SalesPaymentMethod.wechat;
    const date = session.endTime?.getTime() ?? Date.now();
    const spaceName = session.space?.name ?? '';

    items.push({
      id: `guest-payable-${session.id}`,
      productName: `${spaceName}${SPACE_GUEST_PAYABLE_ITEM_NAME}`,
      quantity: 1,
      totalRevenue: Money.fromDbCents(payableAmountCents).toOutputYuan(),
      paymentLabel: PAYMENT_METHOD_CONFIG[paymentMethod].label,
      paymentColor: SPACE_GUEST_PAYABLE_COLOR,
      operatorName: '空间自动结账',
      date,
      currentStock: null,
      stockUnit: null,
    });
  }

  return items;
};

export const mergeDisplayedOrderItems = (
  orderItems: OrderItemRow[],
  refundOrders: RefundOrderRow[],
  settledSpaceSessions: Parameters<typeof buildGuestPayableItems>[0] = [],
): HandoverOrderItemDto[] => {
  const guestPayableItems = buildGuestPayableItems(settledSpaceSessions);
  const merged = [
    ...refundOrders.map((order) => mapRefundOrderItem(order)),
    ...orderItems.map((item) => mapOrderItem(item)),
    ...guestPayableItems,
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
    const rawAmountCents = Money.fromDbCents(Number(item.salePrice)).multiply(item.quantity).toDbCents();
    const amountCents =
      rawAmountCents > 0 ||
      item.productName === SPACE_PREPAID_DEDUCTION_ITEM_NAME ||
      item.productName === SPACE_RENEW_DEDUCTION_ITEM_NAME
        ? Math.abs(rawAmountCents)
        : 0;
    if (amountCents <= 0) {
      continue;
    }

    const paymentMethod = resolveOrderItemPaymentMethod(item);
    paymentAmountMap.set(
      paymentMethod,
      Money.fromDbCents(paymentAmountMap.get(paymentMethod) ?? 0)
        .add(Money.fromDbCents(amountCents))
        .toDbCents(),
    );
  }

  return Array.from(paymentAmountMap.entries()).map(([method, amountCents]) => ({
    method,
    label: PAYMENT_METHOD_CONFIG[method].label,
    amount: Money.fromDbCents(amountCents).toOutputYuan(),
    ratio: 0,
    color: PAYMENT_METHOD_CONFIG[method].color,
  }));
};

export const attachPaymentRatios = (
  items: HandoverPaymentItemDto[],
  totalRevenueYuan: number,
): HandoverPaymentItemDto[] =>
  items.map((item) => ({
    ...item,
    ratio: totalRevenueYuan > 0
      ? Math.round((item.amount / totalRevenueYuan) * 100) / 100
      : 0,
  }));

export const sumPaymentAmounts = (items: HandoverPaymentItemDto[]): number =>
  items.reduce((acc, item) => acc + item.amount, 0);

export const buildRevenueAmounts = (
  spaceRevenue: Prisma.Decimal | number | string | null | undefined,
  additionalRevenue: Prisma.Decimal | number | string | null | undefined,
  refundRevenue: Prisma.Decimal | number | string | null | undefined,
): {
  additionalRevenueAmount: number;
  spaceRevenueAmount: number;
  refundAmount: number;
} => ({
  additionalRevenueAmount: dbCentsToOutputYuan(additionalRevenue),
  spaceRevenueAmount: dbCentsToOutputYuan(spaceRevenue),
  refundAmount: Math.abs(dbCentsToOutputYuan(refundRevenue)),
});

export const buildRecordRevenueSummary = (
  revenueAmounts: ReturnType<typeof buildRevenueAmounts>,
  orderCount: number,
  pettyCashAmount: number,
): NonNullable<HandoverRecordListItemDto['revenueSummary']> => {
  // 营业收入 = additionalRevenue（仅非空间订单，不含负数）
  // 空间管理 = spaceRevenue（空间会话消费金额）
  // 本班营业额 = 营业收入 + 空间管理
  return {
    additionalRevenue: revenueAmounts.additionalRevenueAmount,
    spaceRevenue: revenueAmounts.spaceRevenueAmount,
    refundAmount: revenueAmounts.refundAmount,
    totalRevenue: revenueAmounts.additionalRevenueAmount + revenueAmounts.spaceRevenueAmount,
    orderCount,
    pettyCache: pettyCashAmount,
  };
};
