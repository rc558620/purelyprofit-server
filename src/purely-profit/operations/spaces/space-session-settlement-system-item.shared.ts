import { Money } from '../../../shared/money.utils';
import {
  GROUPON_VOUCHER_CATEGORY_NAME,
  GROUPON_VOUCHER_ITEM_SUFFIX,
  SELF_ORDER_DEDUCTION_PRODUCT_ID,
} from '../../commerce/commerce.utils';
import type { SpaceSessionItemRecord } from './space-sessions.types';

/** 系统虚拟行 productId：不对应真实商品，统一 SYS_ 前缀 */
export const SYS_TIME_BILLING_PRODUCT_ID = 'SYS_TIME_BILLING';
export const SYS_RENEW_DEDUCTION_PRODUCT_ID = 'SYS_RENEW_DEDUCTION';
export const SYS_PREPAID_DEDUCTION_PRODUCT_ID = 'SYS_PREPAID_DEDUCTION';
export const SYS_EMPTY_SETTLEMENT_PRODUCT_ID = 'SYS_EMPTY_SETTLEMENT';

/**
 * 纯消费（items）模式下开台团购券的「正向消费行」。
 *
 * 背景：券在 purelyClub 已由顾客支付，但购买时不生成销售单/流水，
 * 门店侧此前只在结账时记一条负向「预付款」抵扣行，导致：
 *  - 券面金额完全不计入营业额与护理档案（护理档案显示 ¥0）；
 *  - 券面大于本次消费时合计为负，界面变成「应退金额」（券余额本不该退）。
 *
 * 修复方式：券面金额额外生成一条**正向消费行**计入消费与营业额，
 * 与原负向抵扣行金额相等、符号相反 → 合计恒等于本次现场消费（永不出现负数）。
 * 该行与台位费行同属系统虚拟行：不计入销售件数，不进商品排行榜。
 */
export const SYS_GROUPON_VOUCHER_PRODUCT_ID = 'SYS_GROUPON_VOUCHER';

/** 查不到券商品名时的兜底展示名 */
export const GROUPON_VOUCHER_FALLBACK_PRODUCT_NAME = '团购券';

// 券面行的后缀与分类以 commerce.utils（最低层）为唯一来源后转出：
// 读取侧判定（isGrouponVoucherItemName / isNonQuantitySalesRecordRow）依赖同两个
// 常量，两处各写一份会产生口径漂移，导致「写了但读不出来」。
export { GROUPON_VOUCHER_CATEGORY_NAME, GROUPON_VOUCHER_ITEM_SUFFIX };

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
  productId === SYS_EMPTY_SETTLEMENT_PRODUCT_ID ||
  // 券面消费行不是真实商品销量，只是券面金额的记账载体
  productId === SYS_GROUPON_VOUCHER_PRODUCT_ID;

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
