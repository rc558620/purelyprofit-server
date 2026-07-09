import { Money } from '../../../shared/money.utils';
import type { SpaceSessionItemRecord } from './space-sessions.types';

/**
 * 计算单行金额合计（salePrice × quantity），全程 Money 运算避免浮点尾巴。
 */
const calcLineTotal = (salePrice: number, quantity: number): number =>
  Money.fromInputYuan(salePrice).multiply(quantity).toOutputYuan();

/**
 * 汇总商品行金额（salePrice × quantity），全程 Money 运算。
 * items 中的 salePrice 已经由 mapSessionItemRows 转为元，
 * 需要再转回分才能用 Money 做精确运算。
 */
export const sumLineTotalMoney = (items: SpaceSessionItemRecord[]): Money =>
  items.reduce(
    (sum, item) =>
      sum.add(Money.fromInputYuan(item.salePrice).multiply(item.quantity)),
    Money.zero(),
  );

/**
 * 汇总商品行利润（profit × quantity），全程 Money 运算。
 */
export const sumLineProfitMoney = (items: SpaceSessionItemRecord[]): Money =>
  items.reduce(
    (sum, item) =>
      sum.add(Money.fromInputYuan(item.profit).multiply(item.quantity)),
    Money.zero(),
  );

export const mergeSessionItems = (
  currentItems: SpaceSessionItemRecord[],
  appendedItems: SpaceSessionItemRecord[],
): SpaceSessionItemRecord[] => {
  const mergedItems = currentItems.map((item) => ({ ...item }));

  for (const item of appendedItems) {
    // BUG-6 修复：用整数分比较避免浮点 === 在极端情况下匹配失败
    // （salePrice 经 toFixed(2) + parseFloat 转换，整数分数据通常无损，
    //  但防御性地回算到分再做整数比较更安全）
    const itemPriceCents = Math.round(item.salePrice * 100);
    const existing = mergedItems.find(
      (currentItem) =>
        currentItem.productId === item.productId &&
        Math.round(currentItem.salePrice * 100) === itemPriceCents,
    );
    if (existing) {
      existing.quantity += item.quantity;
      existing.lineTotal = calcLineTotal(existing.salePrice, existing.quantity);
    } else {
      mergedItems.push({ ...item });
    }
  }

  return mergedItems;
};
