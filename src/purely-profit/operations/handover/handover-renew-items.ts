import { Money } from '../../../shared/money.utils';
import type { HandoverOrderItemDto } from './dto/handover-shared.dto';
import type { OrderItemRow } from './handover.types';
import {
  SPACE_RENEW_DEDUCTION_ITEM_NAME,
  SPACE_RENEW_DISPLAY_NAME,
  PAYMENT_METHOD_CONFIG,
  GROUPON_VOUCHER_DISPLAY,
  buildGrouponLabel,
  toDisplayName,
  resolveOperatorRole,
} from './handover.shared';

const AUTO_SETTLEMENT_OPERATOR_NAME = '空间自动结账';
const GROUPON_RENEW_PAYMENT_METHOD = 'groupon_voucher';

type RenewAmountByMethod = {
  amount: number;
  latestRenewedAt: number;
  grouponPlatform: string | null;
  grouponCode: string | null;
};

/** 按支付方式汇总同一会话的续费金额，并记录每组最晚续费时间与团购信息 */
const collectRenewAmountByMethod = (
  sessionRenewRecords: NonNullable<
    OrderItemRow['order']['spaceSession']
  >['sessionRenewRecords'],
): Map<string, RenewAmountByMethod> => {
  const amountByMethod = new Map<string, RenewAmountByMethod>();
  for (const record of sessionRenewRecords) {
    const method = record.paymentMethod;
    const renewedAtMs = Number(record.renewedAt);
    const existing = amountByMethod.get(method);
    amountByMethod.set(method, {
      amount: (existing?.amount ?? 0) + record.amount,
      latestRenewedAt: Math.max(existing?.latestRenewedAt ?? 0, renewedAtMs),
      grouponPlatform:
        record.grouponPlatform ?? existing?.grouponPlatform ?? null,
      grouponCode: record.grouponCode ?? existing?.grouponCode ?? null,
    });
  }
  return amountByMethod;
};

/**
 * 续费抵扣项按支付方式拆分：若同一会话使用了多种支付方式续费，
 * 拆为多行展示（如：微信 ¥100、支付宝 ¥50、刷卡 ¥70）。
 *
 * 仅当该会话使用了 >1 种支付方式时才拆分；
 * 否则返回 null，由调用方走常规商品聚合链路。
 */
export const buildRenewSplitItems = (
  item: OrderItemRow,
  storeOwnerUserId: number | null,
): HandoverOrderItemDto[] | null => {
  const spaceSession = item.order.spaceSession;
  if (
    item.productName !== SPACE_RENEW_DEDUCTION_ITEM_NAME ||
    spaceSession == null ||
    spaceSession.sessionRenewRecords.length === 0
  ) {
    return null;
  }

  const amountByMethod = collectRenewAmountByMethod(
    spaceSession.sessionRenewRecords,
  );
  if (amountByMethod.size <= 1) return null;

  const spaceName = toDisplayName(spaceSession.space?.name) ?? '';
  const displayName = spaceName
    ? `${spaceName} · ${SPACE_RENEW_DISPLAY_NAME}`
    : item.productName;
  const operatorName =
    toDisplayName(item.order.operatorNameSnapshot) ??
    toDisplayName(item.order.operatorStaff?.name) ??
    AUTO_SETTLEMENT_OPERATOR_NAME;
  const date = item.order.date.getTime();
  const operatorRole = resolveOperatorRole(
    item.order.operatorStaff ?? null,
    storeOwnerUserId,
  );

  return [...amountByMethod].map(
    ([
      method,
      { amount: amountCents, latestRenewedAt, grouponPlatform, grouponCode },
    ]) => {
      const isGroupon = method === GROUPON_RENEW_PAYMENT_METHOD;
      const config =
        PAYMENT_METHOD_CONFIG[method as keyof typeof PAYMENT_METHOD_CONFIG];

      return {
        id: `renew-${item.id}-${method}`,
        productName: displayName,
        quantity: 1,
        totalRevenue: Money.fromDbCents(Math.abs(amountCents)).toOutputYuan(),
        paymentLabel: isGroupon
          ? buildGrouponLabel(grouponPlatform)
          : (config?.label ?? method),
        paymentColor: isGroupon
          ? GROUPON_VOUCHER_DISPLAY.color
          : (config?.color ?? '#000'),
        operatorName,
        operatorRole,
        date,
        displayDate: latestRenewedAt || date,
        currentStock: null,
        stockUnit: null,
        timeCategory: 'session_renew' as const,
        grouponCode: grouponCode ?? spaceSession.prepaidGrouponCode ?? null,
        hasDiscount: false,
      };
    },
  );
};
