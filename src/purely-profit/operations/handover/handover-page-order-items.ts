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
  SPACE_RENEW_DISPLAY_NAME,
  SPACE_REFUND_DISPLAY_SUFFIX,
  GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD,
  GROUPON_VOUCHER_DISPLAY,
  buildGrouponLabel,
  toDisplayName,
  type OrderItemRow,
  type RefundOrderRow,
  mapOrderItem,
  mapRefundOrderItem,
} from './handover.shared';
import { mapScanOrderingRefundOrderItem } from './handover-order-item.mapper';
import type { SaleOrderRefundRow } from './handover.types';

/** 已结账的空间会话行数据（客人应付 / 退款展示项的数据源） */
export type SettledSpaceSessionRow = {
  id: number;
  timeCost: number | null;
  itemsCost: number;
  prepaidAmount: number | null;
  prepaidGrouponCode: string | null;
  prepaidCustomerPaymentMethod: string | null;
  prepaidGrouponPlatform: string | null;
  endTime: Date | null;
  space: { name: string };
  saleOrder: {
    paymentMethod: SalesPaymentMethod;
    date: Date;
    operatorNameSnapshot: string | null;
    operatorStaff: {
      name: string;
      role: StaffRole;
      userId: number | null;
      employeeProfile: { subAccounts: { role: string } | null } | null;
    } | null;
  } | null;
  // ─── ⚠️ DO NOT REMOVE sessionRenewRecords ──────────────────────────────
  // 历史背景：BUG-1/5/7 修复前，续费会回写 session.prepaidAmount，
  // 导致"开台预付"和"续费"两个资金池混在一起，产生重复抵扣。
  // 修复后 space-session-renew.service.ts 彻底移除了 prepaid* 回写，
  // 因此 session.prepaidAmount **仅包含开台预付款，不含续费金额**。
  // 退款 / 客人应付计算必须从 sessionRenewRecords 独立累加续费金额，
  // 否则续费付款会被忽略，导致：
  //   1. 续费溢出金额无法退还客户（资金损失）
  //   2. 客人应付多算（多收客户钱）
  // 简化方向：不要试图"用 prepaidAmount 代替"或"去掉 sessionRenewRecords"，
  // 这会恢复 BUG-1/5/7 之前的错误行为。
  sessionRenewRecords: {
    amount: number;
    paymentMethod: string;
  }[];
};

/** 解析操作员真实角色（与 handover.mapper.ts 逻辑一致；storeOwnerUserId 用于识别门店主账号=owner） */
const resolveOperatorRole = (
  staff: {
    role: StaffRole;
    userId: number | null;
    employeeProfile: {
      subAccounts: { role: string } | null;
    } | null;
  } | null,
  storeOwnerUserId: number | null = null,
): StaffRole | null => {
  if (!staff) return null;
  // 操作员即门店主账号 → 主账号（store.ownerId 是权威依据，staff.role 历史数据可能未同步）
  if (storeOwnerUserId !== null && staff.userId === storeOwnerUserId) {
    return StaffRole.owner;
  }
  if (staff.role === StaffRole.owner) return StaffRole.owner;
  const subAccountRole = staff.employeeProfile?.subAccounts?.role;
  if (subAccountRole === 'manager') return StaffRole.manager;
  return staff.role;
};

export const buildGuestPayableItems = (
  settledSessions: SettledSpaceSessionRow[],
  storeOwnerUserId: number | null = null,
): HandoverOrderItemDto[] => {
  const items: HandoverOrderItemDto[] = [];

  for (const session of settledSessions) {
    const consumptionCents = Money.fromDbCents(session.timeCost ?? 0)
      .add(Money.fromDbCents(session.itemsCost))
      .toDbCents();
    const prepaidCents = Number(session.prepaidAmount ?? 0);
    // ─── ⚠️ DO NOT 简化为仅 prepaidAmount ─────────────────────────────
    // prepaidAmount 仅含开台预付款，不含续费（BUG-1/5/7 已移除续费回写）。
    // 如果去掉 renewTotalCents，续费付款会被完全忽略：
    //   - 无预付+续费场景：totalPaidCents = 0 → 客人应付 = 全部消费（多收）
    //   - 预付+续费混合场景：客人应付只扣预付部分（多收）
    const renewTotalCents = session.sessionRenewRecords.reduce(
      (sum, r) => sum + Number(r.amount ?? 0),
      0,
    );
    const totalPaidCents = prepaidCents + renewTotalCents;
    // 总已付 < 消费：退款场景（由 buildRefundItemsFromSessions 处理），跳过
    // 总已付 === 消费：生成 ¥0.00 客人应付项，记录结账操作员/时间/支付方式
    // 总已付 > 消费：正常客人应付
    if (consumptionCents < totalPaidCents) continue;

    const payableAmountCents = Money.fromDbCents(consumptionCents)
      .subtract(Money.fromDbCents(totalPaidCents))
      .toDbCents();
    if (payableAmountCents < 0) continue;

    // BUG fix: 当顾客支付方式为团购券时，使用团购标签而非门店侧结算方式（如现金）
    const isGrouponCustomerPayment =
      session.prepaidCustomerPaymentMethod ===
      GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD;
    const paymentLabel = isGrouponCustomerPayment
      ? buildGrouponLabel(session.prepaidGrouponPlatform)
      : PAYMENT_METHOD_CONFIG[
          session.saleOrder?.paymentMethod ?? SalesPaymentMethod.wechat
        ].label;
    const date = session.endTime?.getTime() ?? Date.now();
    const spaceName = session.space?.name ?? '';
    const operatorName =
      toDisplayName(session.saleOrder?.operatorNameSnapshot) ??
      toDisplayName(session.saleOrder?.operatorStaff?.name) ??
      '空间自动结账';
    const operatorRole = resolveOperatorRole(
      session.saleOrder?.operatorStaff ?? null,
      storeOwnerUserId,
    );

    items.push({
      id: `guest-payable-${session.id}`,
      productName: `${spaceName} · ${SPACE_GUEST_PAYABLE_ITEM_NAME}`,
      quantity: 1,
      totalRevenue: Money.fromDbCents(payableAmountCents).toOutputYuan(),
      paymentLabel,
      paymentColor: SPACE_GUEST_PAYABLE_COLOR,
      operatorName,
      operatorRole,
      date,
      displayDate: date,
      currentStock: null,
      stockUnit: null,
      timeCategory: 'session_end',
      grouponCode: session.prepaidGrouponCode ?? null,
      hasDiscount: false,
    });
  }

  return items;
};

/**
 * 从已结账的空间会话中构建退款展示项。
 * 退款条件：(prepaidAmount + renewTotal) > (timeCost + itemsCost)，
 * 即已付总额（开台预付 + 续费）超过实际消费。
 * 退款金额 = -(totalPaid - consumption)，以负数表示退款。
 * 支付标签格式："微信退款" / "支付宝退款"（与历史退款订单一致）。
 *
 * ─── ⚠️ DO NOT 简化为仅 prepaidAmount 判断 ─────────────────────
 * prepaidAmount 仅含开台预付，不含续费（BUG-1/5/7 已移除续费回写）。
 * 原逻辑 `if (prepaidCents <= 0) continue` 在无预付+有续费场景下
 * 会直接跳过，导致续费溢出金额完全无法退款。
 * 必须使用 totalPaidCents = prepaidCents + renewTotalCents 判断。
 */
export const buildRefundItemsFromSessions = (
  settledSessions: SettledSpaceSessionRow[],
  storeOwnerUserId: number | null = null,
): HandoverOrderItemDto[] => {
  const items: HandoverOrderItemDto[] = [];

  for (const session of settledSessions) {
    const prepaidCents = Number(session.prepaidAmount ?? 0);
    // ─── ⚠️ DO NOT 去掉续费累加或改回 prepaidAmount > 0 守卫 ────────
    // prepaidAmount 仅含开台预付款（BUG-1/5/7 已移除续费回写 prepaid*）。
    // 如果只用 prepaidAmount 判断：
    //   - 无预付+有续费场景：prepaidCents = 0 → continue → 退款完全丢失
    //   - 预付+续费混合：refundCents 少算续费部分 → 退款不足
    const renewTotalCents = session.sessionRenewRecords.reduce(
      (sum, r) => sum + Number(r.amount ?? 0),
      0,
    );
    const totalPaidCents = prepaidCents + renewTotalCents;
    if (totalPaidCents <= 0) continue;

    const consumptionCents = Money.fromDbCents(session.timeCost ?? 0)
      .add(Money.fromDbCents(session.itemsCost))
      .toDbCents();
    if (totalPaidCents <= consumptionCents) continue;

    const refundCents = totalPaidCents - consumptionCents;
    // 退款支付方式优先取 saleOrder（结账方式），回退到最新续费记录的支付方式
    const latestRenewMethod =
      session.sessionRenewRecords.length > 0
        ? session.sessionRenewRecords[session.sessionRenewRecords.length - 1]
            .paymentMethod
        : undefined;
    const paymentMethod =
      session.saleOrder?.paymentMethod ??
      (latestRenewMethod as SalesPaymentMethod) ??
      SalesPaymentMethod.wechat;
    const date = session.endTime?.getTime() ?? Date.now();
    // 退款行商品名追加 " · 退款"，无空间名时回退到「空间退款」
    const refundProductName = session.space?.name
      ? `${session.space.name} · ${SPACE_REFUND_DISPLAY_SUFFIX}`
      : SPACE_REFUND_ITEM_NAME;
    const operatorName =
      toDisplayName(session.saleOrder?.operatorNameSnapshot) ??
      toDisplayName(session.saleOrder?.operatorStaff?.name) ??
      '空间自动结账';
    const operatorRole = resolveOperatorRole(
      session.saleOrder?.operatorStaff ?? null,
      storeOwnerUserId,
    );

    items.push({
      id: `refund-session-${session.id}`,
      productName: refundProductName,
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
      grouponCode: session.prepaidGrouponCode ?? null,
      hasDiscount: false,
    });
  }

  return items;
};

// ─────────────────────────────────────────────────────────────────────────────
// 普通商品行聚合（按订单 ID + 商品名称 + 规格叠加）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 将扫码订单商品规格按数量展开为 spec 序列，与 saleOrderItem 按顺序一一对应。
 * 扫码订单的 saleOrderItem 创建顺序与 scanOrder.items 展开顺序一致，
 * 第 i 个 saleOrderItem 的规格对应展开列表中第 i 个单元的规格。
 */
function buildScanItemSpecsList(
  scanOrder: OrderItemRow['order']['scanOrder'],
): string[][] {
  if (!scanOrder?.items || scanOrder.items.length === 0) return [];

  const specsList: string[][] = [];
  for (const scanItem of scanOrder.items) {
    const specs = (scanItem.specs ?? []).map((s) => s.specOptionNameSnapshot);
    for (let i = 0; i < Math.max(scanItem.quantity, 0); i++) {
      specsList.push(specs);
    }
  }
  return specsList;
}

/**
 * 按「商品名称 + 规格」合并同一订单内的相同商品行：
 * 数量直接累加，金额按 salePrice × quantity 之和重算（分单位，后端统一计算）。
 * 规格仅用于分组判定（完全相同才合并），合并行不展示规格字段。
 */
function buildAggregatedOrderItem(
  items: OrderItemRow[],
  storeOwnerUserId: number | null,
  shiftOperatorName: string | null,
  refundedOrderIds: ReadonlySet<number>,
): HandoverOrderItemDto {
  const first = items[0];
  const base = mapOrderItem(
    first,
    storeOwnerUserId,
    shiftOperatorName,
    refundedOrderIds,
  );
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  // 整单金额 = 所有商品行金额之和（分），统一转元展示
  const totalRevenueCents = items.reduce((sum, item) => {
    return (
      sum +
      Money.fromDbCents(item.salePrice).multiply(item.quantity).toDbCents()
    );
  }, 0);

  return {
    ...base,
    quantity: totalQuantity,
    totalRevenue: Money.fromDbCents(totalRevenueCents).toOutputYuan(),
  };
}

/**
 * 对非手工补录的普通商品行按「订单 ID + 商品名称 + 规格」进行聚合：
 * 1. 按订单 ID 分组，组内按 id 升序（匹配扫码订单展开顺序）
 * 2. 扫码订单从 scanOrder.items 展开 spec 序列，每件商品行匹配对应规格
 * 3. 按「商品名称 + 规格字符串化」分组
 * 4. 每组内 >1 行的调用 buildAggregatedOrderItem 合并，单行的直接映射
 */
function aggregateRegularOrderItems(
  items: OrderItemRow[],
  storeOwnerUserId: number | null,
  shiftOperatorName: string | null,
  refundedOrderIds: ReadonlySet<number>,
): HandoverOrderItemDto[] {
  const orderGroups = new Map<number, OrderItemRow[]>();
  for (const item of items) {
    const group = orderGroups.get(item.order.id) ?? [];
    group.push(item);
    orderGroups.set(item.order.id, group);
  }

  const result: HandoverOrderItemDto[] = [];

  for (const [, orderGroup] of orderGroups) {
    // 按 id 升序排序（与扫码订单商品展开顺序一致）
    orderGroup.sort((a, b) => a.id - b.id);

    // 扫码订单构建 spec 序列；非扫码订单返回空列表
    const scanSpecsList = buildScanItemSpecsList(orderGroup[0].order.scanOrder);

    // 按「商品名称 + 规格」分组（同时追踪该组是否有规格）
    type ProductGroup = { items: OrderItemRow[]; hasSpec: boolean };
    const productGroups = new Map<string, ProductGroup>();
    orderGroup.forEach((item, index) => {
      const specs = scanSpecsList[index] ?? [];
      const hasSpec = specs.length > 0;
      const key = `${item.productName}_${JSON.stringify(specs)}`;
      const existing = productGroups.get(key) ?? {
        items: [],
        hasSpec: false,
      };
      existing.items.push(item);
      existing.hasSpec = hasSpec;
      productGroups.set(key, existing);
    });

    // 每组映射为 HandoverOrderItemDto 并补充 hasSpec 标记
    for (const [, group] of productGroups) {
      const dto: HandoverOrderItemDto =
        group.items.length === 1
          ? mapOrderItem(
              group.items[0],
              storeOwnerUserId,
              shiftOperatorName,
              refundedOrderIds,
            )
          : buildAggregatedOrderItem(
              group.items,
              storeOwnerUserId,
              shiftOperatorName,
              refundedOrderIds,
            );
      // 商品带规格时设置标记（前端渲染规格标签）
      if (group.hasSpec) {
        dto.hasSpec = true;
      }
      result.push(dto);
    }
  }

  return result;
}

export const mergeDisplayedOrderItems = (
  orderItems: OrderItemRow[],
  refundOrders: RefundOrderRow[],
  settledSpaceSessions: SettledSpaceSessionRow[] = [],
  storeOwnerUserId: number | null = null,
  /** 当班操作员：扫码点餐订单（purelyClub 下单）无实际操作员时回退展示 */
  shiftOperatorName: string | null = null,
  /** 扫码点餐退款行（SaleOrderRefund）：映射为负数退款行与下单行并存 */
  scanOrderingRefunds: SaleOrderRefundRow[] = [],
): HandoverOrderItemDto[] => {
  const guestPayableItems = buildGuestPayableItems(
    settledSpaceSessions,
    storeOwnerUserId,
  );
  const refundItems = buildRefundItemsFromSessions(
    settledSpaceSessions,
    storeOwnerUserId,
  );
  // 已被退款的销售单 id 集合：退款单会同时返回下单+退款两行，下单行不展示库存
  const refundedOrderIds = new Set(
    scanOrderingRefunds.map((refund) => refund.saleOrder.id),
  );

  // 录入单子（手工补录单）订单：同一订单的多个商品行按商品+规格聚合，
  // 与普通商品行走同一聚合链路（aggregateRegularOrderItems），不合并为整单行。
  // 续费抵扣项按支付方式拆分：若同一会话使用了多种支付方式续费，
  // 拆为多行展示（如：微信 ¥100、支付宝 ¥50、刷卡 ¥70）。
  const mappedOrderItems: HandoverOrderItemDto[] = [];
  // 收集商品行，在循环结束后按订单+商品+规格聚合
  const regularItemsForAggregation: OrderItemRow[] = [];
  for (const item of orderItems) {
    // 手工补录单不再特殊处理，走常规聚合（按商品+规格叠加）
    if (
      item.productName === SPACE_RENEW_DEDUCTION_ITEM_NAME &&
      item.order.spaceSession != null &&
      item.order.spaceSession.sessionRenewRecords.length > 0
    ) {
      const amountByMethod = new Map<
        string,
        {
          amount: number;
          latestRenewedAt: number;
          grouponPlatform: string | null;
          grouponCode: string | null;
        }
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
          grouponPlatform:
            record.grouponPlatform ?? existing?.grouponPlatform ?? null,
          grouponCode: record.grouponCode ?? existing?.grouponCode ?? null,
        });
      }

      if (amountByMethod.size > 1) {
        const spaceName =
          toDisplayName(item.order.spaceSession.space?.name) ?? '';
        const displayName = spaceName
          ? `${spaceName} · ${SPACE_RENEW_DISPLAY_NAME}`
          : item.productName;
        const operatorName =
          toDisplayName(item.order.operatorNameSnapshot) ??
          toDisplayName(item.order.operatorStaff?.name) ??
          '空间自动结账';
        const date = item.order.date.getTime();

        for (const [
          method,
          {
            amount: amountCents,
            latestRenewedAt,
            grouponPlatform,
            grouponCode,
          },
        ] of amountByMethod) {
          const isGroupon = method === 'groupon_voucher';
          const config =
            PAYMENT_METHOD_CONFIG[method as keyof typeof PAYMENT_METHOD_CONFIG];
          const paymentLabel = isGroupon
            ? buildGrouponLabel(grouponPlatform)
            : (config?.label ?? method);
          const paymentColor = isGroupon
            ? GROUPON_VOUCHER_DISPLAY.color
            : (config?.color ?? '#000');

          mappedOrderItems.push({
            id: `renew-${item.id}-${method}`,
            productName: displayName,
            quantity: 1,
            totalRevenue: Money.fromDbCents(
              Math.abs(amountCents),
            ).toOutputYuan(),
            paymentLabel,
            paymentColor,
            operatorName,
            operatorRole: resolveOperatorRole(
              item.order.operatorStaff ?? null,
              storeOwnerUserId,
            ),
            date,
            displayDate: latestRenewedAt || date,
            currentStock: null,
            stockUnit: null,
            timeCategory: 'session_renew',
            grouponCode:
              grouponCode ??
              item.order.spaceSession?.prepaidGrouponCode ??
              null,
            hasDiscount: false,
          });
        }
        continue;
      }
    }
    // 普通商品行：收集到数组，后续按订单+商品+规格聚合
    regularItemsForAggregation.push(item);
  }

  // 对普通商品行进行聚合（按订单 ID + 商品名称 + 规格叠加后映射）
  mappedOrderItems.push(
    ...aggregateRegularOrderItems(
      regularItemsForAggregation,
      storeOwnerUserId,
      shiftOperatorName,
      refundedOrderIds,
    ),
  );

  const merged = [
    ...refundOrders.map((order) => mapRefundOrderItem(order)),
    ...scanOrderingRefunds.map((refund) =>
      mapScanOrderingRefundOrderItem(
        refund,
        storeOwnerUserId,
        shiftOperatorName,
      ),
    ),
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
