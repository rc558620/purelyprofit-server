import type { SpaceSessionItemRecord } from './space-sessions.types';

export const sumLineTotal = (items: SpaceSessionItemRecord[]): number =>
  Number(
    items
      .reduce((sum, item) => sum + item.salePrice * item.quantity, 0)
      .toFixed(2),
  );

export const mergeSessionItems = (
  currentItems: SpaceSessionItemRecord[],
  appendedItems: SpaceSessionItemRecord[],
): SpaceSessionItemRecord[] => {
  const mergedItems = currentItems.map((item) => ({ ...item }));

  for (const item of appendedItems) {
    const existing = mergedItems.find(
      (currentItem) => currentItem.productId === item.productId,
    );
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      mergedItems.push({ ...item });
    }
  }

  return mergedItems;
};
