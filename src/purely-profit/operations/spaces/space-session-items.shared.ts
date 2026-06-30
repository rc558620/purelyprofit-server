import { Money } from '../../../shared/money.utils';
import type { SpaceSessionItemRecord } from './space-sessions.types';

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
    const existing = mergedItems.find(
      (currentItem) =>
        currentItem.productId === item.productId &&
        currentItem.salePrice === item.salePrice,
    );
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      mergedItems.push({ ...item });
    }
  }

  return mergedItems;
};
