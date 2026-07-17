import { SalesPaymentMethod, StaffRole } from '@prisma/client';
import {
  isPrepaidDeductionItem,
  isSessionStartItem,
  SPACE_RENEW_DEDUCTION_ITEM_NAME,
  SPACE_RENEW_DISPLAY_NAME,
  SPACE_REFUND_ITEM_NAME,
  SPACE_REFUND_DISPLAY_SUFFIX,
  CASHIER_PREFIX,
  resolveTimeCategory,
  PAYMENT_METHOD_CONFIG,
  GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD,
  GROUPON_VOUCHER_DISPLAY,
  buildGrouponLabel,
} from './handover.constants';
import type { OrderItemRow, RefundOrderRow } from './handover.types';
import type { HandoverOrderItemDto } from './dto/handover-shared.dto';
import { Money } from '../../../shared/money.utils';
import { toDisplayName, dbCentsToOutputYuan } from './handover.utils';

const AUTO_SETTLEMENT_OPERATOR_NAME = '空间自动结账';

const SALES_PAYMENT_METHOD_VALUES = new Set(Object.values(SalesPaymentMethod));

const isSalesPaymentMethod = (value: unknown): value is SalesPaymentMethod =>
  typeof value === 'string' &&
  SALES_PAYMENT_METHOD_VALUES.has(value as SalesPaymentMethod);

const parseRenewPaymentMethods = (
  sessionRenewRecords: Array<{ paymentMethod: string }>,
): SalesPaymentMethod[] =>
  sessionRenewRecords
    .map((record) => record.paymentMethod)
    .filter(isSalesPaymentMethod);

const resolveOrderItemProductName = (item: OrderItemRow): string => {
  const spaceName = toDisplayName(item.order.spaceSession?.space?.name);

  // 续费抵扣在 DB 中存储为「续费抵扣」，交班明细展示时去掉「抵扣」二字，仅展示「续费」
  if (item.productName === SPACE_RENEW_DEDUCTION_ITEM_NAME) {
    const prefix = spaceName ?? CASHIER_PREFIX;
    return `${prefix} · ${SPACE_RENEW_DISPLAY_NAME}`;
  }

  // 空间会话商品：用 " · " 分隔，如 "大包2 · 预付款"、"大包2 · 台位费（固定）"、"大包2 · 面包"
  if (item.order.spaceSession != null && spaceName) {
    return `${spaceName} · ${item.productName}`;
  }

  // 无空间会话的普通商品：统一加「收银台 · 」前缀
  return `${CASHIER_PREFIX} · ${item.productName}`;
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
    isPrepaidDeductionItem(item.productName) &&
    spaceSession.prepaidPaymentMethod
  ) {
    return spaceSession.prepaidPaymentMethod;
  }

  if (item.productName !== SPACE_RENEW_DEDUCTION_ITEM_NAME) {
    return fallbackPaymentMethod;
  }

  const renewPaymentMethods = [
    ...new Set(parseRenewPaymentMethods(spaceSession.sessionRenewRecords)),
  ];

  return renewPaymentMethods.length === 1
    ? renewPaymentMethods[0]
    : fallbackPaymentMethod;
};

/**
 * 从续费记录中提取第一条团购平台标识。
 * 用于续费项在交班页面显示「美团团购」「抖音团购」等完整标签。
 */
const resolveRenewGrouponPlatform = (
  sessionRenewRecords: Array<{
    paymentMethod: string;
    grouponPlatform: string | null;
  }>,
): string | null => {
  for (const record of sessionRenewRecords) {
    if (record.paymentMethod === 'groupon_voucher' && record.grouponPlatform) {
      return record.grouponPlatform;
    }
  }
  return null;
};

/**
 * 从续费记录中提取第一条团购券码。
 * 用于无开台预付团购时，续费项也能展示券码。
 */
const resolveRenewGrouponCode = (
  sessionRenewRecords:
    | Array<{ paymentMethod: string; grouponCode: string | null }>
    | undefined,
): string | null => {
  if (!sessionRenewRecords) return null;
  for (const record of sessionRenewRecords) {
    if (record.paymentMethod === 'groupon_voucher' && record.grouponCode) {
      return record.grouponCode;
    }
  }
  return null;
};

/**
 * 解析订单项的支付显示信息（label + color）。
 * 核心规则：
 *   1. 开台项（预付款 / 台位费）顾客支付方式为团购券时 → 显示「美团团购」「抖音团购」等
 *   2. 续费项支付方式为团购券时 → 从续费记录提取平台标识，同样显示「xxx团购」
 */
export const resolveOrderItemPaymentDisplay = (
  item: OrderItemRow,
): { paymentLabel: string; paymentColor: string } => {
  const paymentMethod = resolveOrderItemPaymentMethod(item);
  const spaceSession = item.order.spaceSession;

  // 开台项（预付款 / 台位费）+ 顾客支付方式为团购 → 显示「美团团购」「抖音团购」等
  if (
    isSessionStartItem(item.productName) &&
    spaceSession?.prepaidCustomerPaymentMethod ===
      GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD
  ) {
    return {
      paymentLabel: buildGrouponLabel(spaceSession.prepaidGrouponPlatform),
      paymentColor: GROUPON_VOUCHER_DISPLAY.color,
    };
  }

  // 续费项 + 支付方式为团购 → 从续费记录提取平台标识，显示「美团团购」「抖音团购」等
  if (
    item.productName === SPACE_RENEW_DEDUCTION_ITEM_NAME &&
    paymentMethod === ('groupon_voucher' as SalesPaymentMethod) &&
    spaceSession
  ) {
    const renewPlatform = resolveRenewGrouponPlatform(
      spaceSession.sessionRenewRecords,
    );
    return {
      paymentLabel: buildGrouponLabel(renewPlatform),
      paymentColor: GROUPON_VOUCHER_DISPLAY.color,
    };
  }

  return {
    paymentLabel: PAYMENT_METHOD_CONFIG[paymentMethod].label,
    paymentColor: PAYMENT_METHOD_CONFIG[paymentMethod].color,
  };
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
  if (staff.role === StaffRole.owner) return StaffRole.owner;
  const subAccountRole = staff.employeeProfile?.subAccounts[0]?.role;
  if (subAccountRole === 'manager') return StaffRole.manager;
  return staff.role;
};

export const mapOrderItem = (item: OrderItemRow): HandoverOrderItemDto => {
  // 抵扣项（预付款/续费抵扣）代表已收到的钱，展示时应为正数。
  // 旧数据 DB 中可能存为负数（结算计算遗留），新数据已修正为正数。
  // 此处统一取绝对值，确保前端直接展示，无需任何业务计算。
  const isDeduction =
    isPrepaidDeductionItem(item.productName) ||
    item.productName === SPACE_RENEW_DEDUCTION_ITEM_NAME;
  const salePriceCents = isDeduction
    ? Math.abs(item.salePrice)
    : item.salePrice;
  const totalRevenue = Money.fromDbCents(salePriceCents)
    .multiply(item.quantity)
    .toOutputYuan();
  const { paymentLabel, paymentColor } = resolveOrderItemPaymentDisplay(item);
  const productName = resolveOrderItemProductName(item);
  const timeCategory = resolveTimeCategory(item.productName, paymentLabel);

  // 开台项（预付款/台位费）优先使用 SpaceSession 上的开台操作员；
  // 结账项（客人应付/退款）和普通项使用 SaleOrder 上的操作员。
  const session = item.order.spaceSession;
  const isOpenItem = timeCategory === 'session_start' && session != null;
  const operatorName = isOpenItem
    ? (toDisplayName(session.openOperatorNameSnapshot) ??
      toDisplayName(session.openOperatorStaff?.name) ??
      toDisplayName(item.order.operatorNameSnapshot) ??
      toDisplayName(item.order.operatorStaff?.name) ??
      AUTO_SETTLEMENT_OPERATOR_NAME)
    : (toDisplayName(item.order.operatorNameSnapshot) ??
      toDisplayName(item.order.operatorStaff?.name) ??
      AUTO_SETTLEMENT_OPERATOR_NAME);
  const operatorRole = isOpenItem
    ? (resolveOperatorRole(session.openOperatorStaff) ??
      resolveOperatorRole(item.order.operatorStaff))
    : resolveOperatorRole(item.order.operatorStaff);

  // displayDate：业务语义时间，前端显示用
  // session_start（开台）→ SpaceSession.startTime
  // session_renew（续费）→ sessionRenewRecords 中最晚的 renewedAt
  // 其他（结账/普通）→ SaleOrder.date
  const displayDate = (() => {
    if (timeCategory === 'session_start' && session?.startTime) {
      return session.startTime.getTime();
    }
    if (
      timeCategory === 'session_renew' &&
      session?.sessionRenewRecords.length
    ) {
      return Math.max(
        ...session.sessionRenewRecords.map((r) => Number(r.renewedAt)),
      );
    }
    return item.order.date.getTime();
  })();

  return {
    id: String(item.id),
    productName,
    quantity: item.quantity,
    totalRevenue,
    paymentLabel,
    paymentColor,
    operatorName,
    operatorRole,
    // date 始终用 SaleOrder.date，同结账批次项共享同一值，保证排序聚合
    date: item.order.date.getTime(),
    displayDate,
    currentStock: item.product?.stock ?? null,
    stockUnit: item.product?.unit ?? null,
    timeCategory,
    grouponCode:
      session?.prepaidGrouponCode ??
      resolveRenewGrouponCode(session?.sessionRenewRecords) ??
      null,
  };
};

export const mapRefundOrderItem = (
  order: RefundOrderRow,
): HandoverOrderItemDto => {
  const spaceName = order.spaceSession?.space.name;
  // 退款行商品名追加 " · 退款"，无空间名时回退到「空间退款」
  const productName = spaceName
    ? `${spaceName} · ${SPACE_REFUND_DISPLAY_SUFFIX}`
    : SPACE_REFUND_ITEM_NAME;
  return {
    id: `refund-order-${order.id}`,
    productName,
    quantity: 1,
    totalRevenue: dbCentsToOutputYuan(order.totalRevenue),
    paymentLabel: `${PAYMENT_METHOD_CONFIG[order.paymentMethod].label}退款`,
    paymentColor: PAYMENT_METHOD_CONFIG[order.paymentMethod].color,
    operatorName:
      toDisplayName(order.operatorNameSnapshot) ??
      toDisplayName(order.operatorStaff?.name) ??
      AUTO_SETTLEMENT_OPERATOR_NAME,
    operatorRole: resolveOperatorRole(order.operatorStaff),
    date: order.date.getTime(),
    displayDate: order.date.getTime(),
    currentStock: null,
    stockUnit: null,
    timeCategory: 'session_end',
    grouponCode: null,
  };
};
