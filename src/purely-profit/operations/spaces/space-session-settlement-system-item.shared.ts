import { Money } from '../../../shared/money.utils';
import { SELF_ORDER_DEDUCTION_PRODUCT_ID } from '../../commerce/commerce.utils';
import type { SpaceSessionItemRecord } from './space-sessions.types';

/** 系统虚拟行 productId：不对应真实商品，统一 SYS_ 前缀 */
export const SYS_TIME_BILLING_PRODUCT_ID = 'SYS_TIME_BILLING';
export const SYS_RENEW_DEDUCTION_PRODUCT_ID = 'SYS_RENEW_DEDUCTION';
export const SYS_PREPAID_DEDUCTION_PRODUCT_ID = 'SYS_PREPAID_DEDUCTION';
export const SYS_EMPTY_SETTLEMENT_PRODUCT_ID = 'SYS_EMPTY_SETTLEMENT';

/**
 * SpaceSessionItem.sourceType 标记：会员自助下单且已在线支付。
 * 与 purely-club/self-ordering 写入端保持一致（跨模块不复用其常量，避免反向依赖）。
 */
export const SELF_ORDER_ITEM_SOURCE_TYPE = 'member_self_order';

/** 系统收入/抵扣行的展示分类 */
export const VENUE_ORDER_ITEM_CATEGORY_NAME = '场地费';

const isSpaceSessionDeductionItem = (productId: string): boolean =>
  productId === SYS_RENEW_DEDUCTION_PRODUCT_ID ||
  productId === SYS_PREPAID_DEDUCTION_PRODUCT_ID ||
  productId === SELF_ORDER_DEDUCTION_PRODUCT_ID;

/**
 * BUG-7 fix: 导出基于 productId 的抵扣项判定函数，
 * 供 settlement.service 及下游统一使用，避免 productName 文案变更后判定静默失效。
 */
export const isSpaceSessionDeductionProductId = isSpaceSessionDeductionItem;

/**
 * B5 fix: 判断是否为不计入销售件数的系统虚拟行。
 * 包含抵扣项（负值行）和台位费/空结算等系统占位行，
 * 避免 totalQuantity 虚高污染销量统计。
 */
export const isNonQuantitySystemItem = (productId: string): boolean =>
  isSpaceSessionDeductionItem(productId) ||
  productId === SYS_TIME_BILLING_PRODUCT_ID ||
  productId === SYS_EMPTY_SETTLEMENT_PRODUCT_ID;

/**
 * 自助下单已支付商品抵扣合计（Money，全程分单位运算）。
 * 结账预览与会话详情接口共用此函数，保证两处口径完全一致，
 * 前端只读展示，不参与任何金额计算。
 */
export const sumSelfOrderDeductionMoney = (
  items: SpaceSessionItemRecord[],
): Money =>
  items.reduce(
    (sum, item) =>
      item.sourceType === SELF_ORDER_ITEM_SOURCE_TYPE
        ? sum.add(Money.fromInputYuan(item.lineTotal))
        : sum,
    Money.zero(),
  );

/**
 * 空会话结算占位行：会话无任何商品行且无台位费时，
 * 仍然落一条 0 元「场地结账」行，保证销售单据结构完整。
 */
export const buildEmptySettlementOrderItem = (): SpaceSessionItemRecord => ({
  productId: SYS_EMPTY_SETTLEMENT_PRODUCT_ID,
  productName: '场地结账',
  categoryName: VENUE_ORDER_ITEM_CATEGORY_NAME,
  salePrice: 0,
  profit: 0,
  quantity: 1,
  lineTotal: 0,
});
