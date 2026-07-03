import {
  EmployeeShiftType,
  Prisma,
  SalesPaymentMethod,
  SpaceSessionStatus,
  StaffRole,
} from '@prisma/client';
import { Money, calcRatioPercent } from '../../../shared/money.utils';
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
  isPrepaidDeductionItem,
  SPACE_REFUND_ITEM_NAME,
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
              amount: true,
              renewedAt: true,
            },
          },
          space: {
            select: {
              name: true,
            },
          },
          openOperatorNameSnapshot: true,
          openOperatorStaff: {
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


/** 解析操作员真实角色（与 handover.mapper.ts 逻辑一致） */
const resolveOperatorRole = (
  staff: {
    role: StaffRole;
    employeeProfile: {
      subAccounts: { role: string }[];
    } | null;
  } | null,
): StaffRole | null => {
  if (!staff) return null;
  if (staff.role === StaffRole.owner) return StaffRole.owner;
  const subAccountRole = staff.employeeProfile?.subAccounts[0]?.role;
  if (subAccountRole === 'manager') return StaffRole.manager;
  return staff.role;
};

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
      operatorNameSnapshot: string | null;
      operatorStaff: {
        name: string;
        role: StaffRole;
        employeeProfile: { subAccounts: { role: string }[] } | null;
      } | null;
    } | null;
  }>,
): HandoverOrderItemDto[] => {
  const items: HandoverOrderItemDto[] = [];

  for (const session of settledSessions) {
    const consumptionCents = Money.fromDbCents(session.timeCost ?? 0)
      .add(Money.fromDbCents(session.itemsCost))
      .toDbCents();
    const prepaidCents = Number(session.prepaidAmount ?? 0);
    // 消费 < 预付款：退款场景（由 buildRefundItemsFromSessions 处理），跳过
    // 消费 === 预付款：生成 ¥0.00 客人应付项，记录结账操作员/时间/支付方式
    // 消费 > 预付款：正常客人应付
    if (consumptionCents < prepaidCents) continue;

    const payableAmountCents = Money.fromDbCents(consumptionCents)
      .subtract(Money.fromDbCents(prepaidCents))
      .toDbCents();
    if (payableAmountCents < 0) continue;

    const paymentMethod =
      session.saleOrder?.paymentMethod ?? SalesPaymentMethod.wechat;
    const date = session.endTime?.getTime() ?? Date.now();
    const spaceName = session.space?.name ?? '';
    const operatorName =
      toDisplayName(session.saleOrder?.operatorNameSnapshot) ??
      toDisplayName(session.saleOrder?.operatorStaff?.name) ??
      '空间自动结账';
    const operatorRole = resolveOperatorRole(
      session.saleOrder?.operatorStaff ?? null,
    );

    items.push({
      id: `guest-payable-${session.id}`,
      productName: `${spaceName}${SPACE_GUEST_PAYABLE_ITEM_NAME}`,
      quantity: 1,
      totalRevenue: Money.fromDbCents(payableAmountCents).toOutputYuan(),
      paymentLabel: PAYMENT_METHOD_CONFIG[paymentMethod].label,
      paymentColor: SPACE_GUEST_PAYABLE_COLOR,
      operatorName,
      operatorRole,
      date,
      currentStock: null,
      stockUnit: null,
      timeCategory: 'session_end',
    });
  }

  return items;
};

/**
 * 从已结账的空间会话中构建退款展示项。
 * 退款条件：prepaidAmount > (timeCost + itemsCost)，即预付款超过实际消费。
 * 退款金额 = -(prepaidAmount - consumption)，以负数表示退款。
 * 支付标签格式："微信退款" / "支付宝退款"（与历史退款订单一致）。
 */
export const buildRefundItemsFromSessions = (
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
      operatorNameSnapshot: string | null;
      operatorStaff: {
        name: string;
        role: StaffRole;
        employeeProfile: { subAccounts: { role: string }[] } | null;
      } | null;
    } | null;
  }>,
): HandoverOrderItemDto[] => {
  const items: HandoverOrderItemDto[] = [];

  for (const session of settledSessions) {
    const prepaidCents = Number(session.prepaidAmount ?? 0);
    if (prepaidCents <= 0) continue;

    const consumptionCents = Money.fromDbCents(session.timeCost ?? 0)
      .add(Money.fromDbCents(session.itemsCost))
      .toDbCents();
    if (prepaidCents <= consumptionCents) continue;

    const refundCents = prepaidCents - consumptionCents;
    const paymentMethod =
      session.saleOrder?.paymentMethod ?? SalesPaymentMethod.wechat;
    const date = session.endTime?.getTime() ?? Date.now();
    const spaceName = session.space?.name ?? SPACE_REFUND_ITEM_NAME;
    const operatorName =
      toDisplayName(session.saleOrder?.operatorNameSnapshot) ??
      toDisplayName(session.saleOrder?.operatorStaff?.name) ??
      '空间自动结账';
    const operatorRole = resolveOperatorRole(
      session.saleOrder?.operatorStaff ?? null,
    );

    items.push({
      id: `refund-session-${session.id}`,
      productName: spaceName,
      quantity: 1,
      totalRevenue: -Money.fromDbCents(refundCents).toOutputYuan(),
      paymentLabel: `${PAYMENT_METHOD_CONFIG[paymentMethod].label}退款`,
      paymentColor: PAYMENT_METHOD_CONFIG[paymentMethod].color,
      operatorName,
      operatorRole,
      date,
      currentStock: null,
      stockUnit: null,
      timeCategory: 'session_end',
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
  const refundItems = buildRefundItemsFromSessions(settledSpaceSessions);

  // 续费抵扣项按支付方式拆分：若同一会话使用了多种支付方式续费，
  // 拆为多行展示（如：微信 ¥100、支付宝 ¥50、刷卡 ¥70）。
  const mappedOrderItems: HandoverOrderItemDto[] = [];
  for (const item of orderItems) {
    if (
      item.productName === SPACE_RENEW_DEDUCTION_ITEM_NAME &&
      item.order.spaceSession != null &&
      item.order.spaceSession.sessionRenewRecords.length > 0
    ) {
      const amountByMethod = new Map<
        string,
        { amount: number; latestRenewedAt: number }
      >();
      for (const record of item.order.spaceSession.sessionRenewRecords) {
        const method = record.paymentMethod;
        const renewedAtMs = Number(record.renewedAt);
        const existing = amountByMethod.get(method);
        amountByMethod.set(method, {
          amount: (existing?.amount ?? 0) + record.amount,
          latestRenewedAt: Math.max(
            existing?.latestRenewedAt ?? 0,
            renewedAtMs,
          ),
        });
      }

      if (amountByMethod.size > 1) {
        const spaceName =
          toDisplayName(item.order.spaceSession.space?.name) ?? '';
        const displayName = spaceName
          ? `${spaceName} · ${SPACE_RENEW_DEDUCTION_ITEM_NAME}`
          : item.productName;
        const operatorName =
          toDisplayName(item.order.operatorNameSnapshot) ??
          toDisplayName(item.order.operatorStaff?.name) ??
          '';
        const date = item.order.date.getTime();

        for (const [
          method,
          { amount: amountCents, latestRenewedAt },
        ] of amountByMethod) {
          const paymentMethod = method as keyof typeof PAYMENT_METHOD_CONFIG;
          const config = PAYMENT_METHOD_CONFIG[paymentMethod];
          if (!config) continue;

          mappedOrderItems.push({
            id: `renew-${item.id}-${method}`,
            productName: displayName,
            quantity: 1,
            totalRevenue: Money.fromDbCents(
              Math.abs(amountCents),
            ).toOutputYuan(),
            paymentLabel: config.label,
            paymentColor: config.color,
            operatorName,
            operatorRole: resolveOperatorRole(item.order.operatorStaff ?? null),
            date: latestRenewedAt || date,
            currentStock: null,
            stockUnit: null,
            timeCategory: 'session_renew',
          });
        }
        continue;
      }
    }
    mappedOrderItems.push(mapOrderItem(item));
  }

  const merged = [
    ...refundOrders.map((order) => mapRefundOrderItem(order)),
    ...refundItems,
    ...mappedOrderItems,
    ...guestPayableItems,
  ];

  return merged
    .sort((left, right) => {
      if (right.date !== left.date) {
        return right.date - left.date;
      }
      const leftIsRefund = left.id.startsWith('refund-');
      const rightIsRefund = right.id.startsWith('refund-');
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
    const rawAmountCents = Money.fromDbCents(item.salePrice)
      .multiply(item.quantity)
      .toDbCents();
    const amountCents =
      rawAmountCents > 0 ||
      isPrepaidDeductionItem(item.productName) ||
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

  return Array.from(paymentAmountMap.entries()).map(
    ([method, amountCents]) => ({
      method,
      label: PAYMENT_METHOD_CONFIG[method].label,
      amount: Money.fromDbCents(amountCents).toOutputYuan(),
      ratio: 0,
      color: PAYMENT_METHOD_CONFIG[method].color,
    }),
  );
};

/**
 * 为每个收款项附加占比（ratio），消费统一封装的 calcRatioPercent。
 * ratio 语义：0-100 整数百分比，前端直接展示，无需任何转换。
 * totalYuan 应为收款金额合计（元），而非营业额。
 */
export const attachPaymentRatios = (
  items: HandoverPaymentItemDto[],
  totalYuan: number,
): HandoverPaymentItemDto[] =>
  items.map((item) => ({
    ...item,
    ratio: calcRatioPercent(item.amount, totalYuan, 0),
  }));

export const sumPaymentAmounts = (items: HandoverPaymentItemDto[]): number =>
  Money.sum(
    items.map((item) => Money.fromInputYuan(item.amount)),
  ).toOutputYuan();

/**
 * 从已结账的空间会话中计算退款金额。
 * 退款 = 预付款 > 实际消费时的差额（退给客人的金额）。
 * 直接基于 SpaceSession 数据计算，不依赖 SaleOrder.totalRevenue 符号。
 */
export const computeRefundAmountFromSessions = (
  sessions: Array<{
    timeCost: number | null;
    itemsCost: number;
    prepaidAmount: number | null;
  }>,
): number => {
  let totalRefundCents = 0;

  for (const session of sessions) {
    const prepaidCents = Number(session.prepaidAmount ?? 0);
    if (prepaidCents <= 0) continue;

    const consumptionCents = Money.fromDbCents(session.timeCost ?? 0)
      .add(Money.fromDbCents(session.itemsCost))
      .toDbCents();

    const refundCents = prepaidCents - consumptionCents;
    if (refundCents > 0) {
      totalRefundCents += refundCents;
    }
  }

  return Money.fromDbCents(totalRefundCents).toOutputYuan();
};

export const buildRevenueAmounts = (
  spaceRevenue: Prisma.Decimal | number | null | undefined,
  additionalRevenue: Prisma.Decimal | number | null | undefined,
  refundAmount: number,
): {
  additionalRevenueAmount: number;
  spaceRevenueAmount: number;
  refundAmount: number;
} => ({
  additionalRevenueAmount: dbCentsToOutputYuan(additionalRevenue),
  spaceRevenueAmount: dbCentsToOutputYuan(spaceRevenue),
  refundAmount,
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
    totalRevenue: Money.fromInputYuan(revenueAmounts.additionalRevenueAmount)
      .add(Money.fromInputYuan(revenueAmounts.spaceRevenueAmount))
      .toOutputYuan(),
    orderCount,
    pettyCache: pettyCashAmount,
  };
};
