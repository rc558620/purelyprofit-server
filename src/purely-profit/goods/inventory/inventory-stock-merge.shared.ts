/**
 * 按 productId 合并商品行，将相同 productId 的 quantity 累加。
 * 防止并行处理时相同商品的多条记录产生 read-modify-write 竞态。
 */
export function mergeInventoryItemsByProductId<
  T extends { productId: number; quantity: number; productName?: string },
>(items: T[]): T[] {
  const map = new Map<number, T>();
  for (const item of items) {
    const existing = map.get(item.productId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      map.set(item.productId, { ...item });
    }
  }
  return Array.from(map.values());
}
