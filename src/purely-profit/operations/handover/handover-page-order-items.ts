import { SalesPaymentMethod, StaffRole } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import type { HandoverOrderItemDto } from './dto/handover-shared.dto';
import {
  ORDER_ITEMS_LIMIT,
  PAYMENT_METHOD_CONFIG,
  SPACE_GUEST_PAYABLE_COLOR,
  SPACE_GUEST_PAYABLE_ITEM_NAME,
  SPACE_REFUND_ITEM_NAME,
  SPACE_RENEW_DEDUCTION_ITEM_NAME,
  toDisplayName,
  type OrderItemRow,
  type RefundOrderRow,
  mapOrderItem,
  mapRefundOrderItem,
} from './handover.shared';

/** 已结账的空间会话行数据（客人应付 / 退款展示项的数据源） */
export type SettledSpaceSessionRow = {
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
};

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
  settledSessions: SettledSpaceSessionRow[],
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
      displayDate: date,
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
  settledSessions: SettledSpaceSessionRow[],
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
      displayDate: date,
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
  settledSpaceSessions: SettledSpaceSessionRow[] = [],
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
            date,
            displayDate: latestRenewedAt || date,
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
