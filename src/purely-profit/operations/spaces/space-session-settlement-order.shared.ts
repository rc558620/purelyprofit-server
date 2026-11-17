import type { Prisma } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { isSpaceSessionDeductionProductId } from './space-session-settlement-system-item.shared';
import type { CreateSessionSaleOrderParams } from './space-session-sale-order.service';
import type { CheckoutAssetsResolution } from './space-session-checkout-assets.shared';
import type { SettleSpaceSessionParams } from './space-session-settlement.types';
import type { SpaceSessionSettlement } from './space-sessions.types';

/**
 * 结账销售单入参：营业额 / 利润按列表口径（消费毛额）落库，
 * 券面 / 卡抵扣不能被抵扣行抹掉；收款构成按列拆分（现金 / 卡抵扣 / 储值余额）。
 */
export const buildSettlementSaleOrderParams = (
  params: SettleSpaceSessionParams,
  settlement: SpaceSessionSettlement,
  checkoutAssets: CheckoutAssetsResolution,
): Omit<CreateSessionSaleOrderParams, 'transaction'> => ({
  storeId: params.session.storeId,
  checkoutAt: params.checkoutAt,
  paymentMethod: params.paymentMethod,
  note: params.note,
  items: settlement.orderItems,
  // 营业额 / 利润按列表口径（消费毛额）落库：券面/卡抵扣不能被抵扣行抹掉
  totalRevenue: settlement.grossRevenue,
  totalProfit: settlement.grossProfit,
  totalQuantity: settlement.totalQuantity,
  // be-06：收款构成按列拆分（现金 / 卡抵扣 / 储值余额）
  cardDeductAmount: checkoutAssets.cardDeductionMoney.toDbCents(),
  balancePaidAmount: checkoutAssets.balanceDeductionMoney.toDbCents(),
  ...(params.customerPaymentMethod !== undefined
    ? { customerPaymentMethod: params.customerPaymentMethod }
    : {}),
  ...(params.grouponCode !== undefined
    ? { grouponCode: params.grouponCode }
    : {}),
  ...(params.grouponPlatform !== undefined
    ? { grouponPlatform: params.grouponPlatform }
    : {}),
  ...(params.settlementChannel !== undefined
    ? { settlementChannel: params.settlementChannel }
    : {}),
  ...(params.voucherCode !== undefined
    ? { voucherCode: params.voucherCode }
    : {}),
  ...(params.voucherPlatform !== undefined
    ? { voucherPlatform: params.voucherPlatform }
    : {}),
  ...(params.voucherFaceAmount !== undefined
    ? { voucherFaceAmount: params.voucherFaceAmount }
    : {}),
  ...(params.settlementStatus !== undefined
    ? { settlementStatus: params.settlementStatus }
    : {}),
  ...(params.platformReceivable !== undefined
    ? { platformReceivable: params.platformReceivable }
    : {}),
  ...(params.platformSettledAmount !== undefined
    ? { platformSettledAmount: params.platformSettledAmount }
    : {}),
  ...(params.platformFee !== undefined
    ? { platformFee: params.platformFee }
    : {}),
});

/**
 * 结账时重写的会话明细行：金额由元转分，抵扣项取绝对值，
 * 并保留来源标记与规格快照（漏写会导致结账后规格「消失」）。
 */
export const buildSettlementSessionItemRows = (
  sessionId: number,
  settlement: SpaceSessionSettlement,
): Prisma.SpaceSessionItemCreateManyInput[] =>
  settlement.orderItems.map((item, index) => ({
    sessionId,
    productId: item.productId,
    productName: item.productName,
    categoryName: item.categoryName,
    // BUG-7 fix: 统一使用 productId 判定抵扣项，避免 productName 文案变更后判定静默失效
    salePrice: isSpaceSessionDeductionProductId(item.productId)
      ? Money.fromInputYuan(Math.abs(item.salePrice)).toDbCents()
      : Money.fromInputYuan(item.salePrice).toDbCents(),
    profit: isSpaceSessionDeductionProductId(item.productId)
      ? Money.fromInputYuan(Math.abs(item.profit)).toDbCents()
      : Money.fromInputYuan(item.profit).toDbCents(),
    quantity: item.quantity,
    sortOrder: index,
    // 保留来源标记（自助下单已在线支付等），供审计与后续对账
    sourceType: item.sourceType ?? null,
    sourceOrderNo: item.sourceOrderNo ?? null,
    sourceOrderItemId: item.sourceOrderItemId ?? null,
    // 规格维度必须随结账重写一起保留：销售记录/交班页的非扫码订单
    // 规格展示依赖此处的快照，漏写会导致结账后规格「消失」
    specSignature: item.specSignature ?? null,
    ...(item.specNames && item.specNames.length > 0
      ? { specNames: item.specNames }
      : {}),
  }));
