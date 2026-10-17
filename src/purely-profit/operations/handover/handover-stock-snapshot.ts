import type { OrderItemRow } from './handover.types';

/** 最小查询接口：便于测试注入（PrismaService 天然满足） */
interface InventoryAdjustmentLogQueryClient {
  findMany: (args: {
    where: {
      saleOrderId: { in: number[] };
      productId: { in: number[] };
      adjustType: 'sale';
    };
    orderBy: { id: 'asc' };
    select: { saleOrderId: true; productId: true; afterStock: true };
  }) => Promise<
    Array<{
      saleOrderId: number | null;
      productId: number | null;
      afterStock: number;
    }>
  >;
}

/**
 * 交班「当前库存」列的销售时点库存快照。
 *
 * ─── 背景 ────────────────────────────────────────────────────────
 * 原实现取商品表实时库存（product.stock），同一商品的历史行全部显示
 * 同一个数字。改为取销售扣减流水（inventory_adjustment_logs，
 * adjustType='sale'）的 afterStock——即该笔销售扣减完成那一刻的库存，
 * 同一商品的本班销售行可以看到 5 → 4 → 3 的递减序列。
 *
 * ─── 兜底 ────────────────────────────────────────────────────────
 * 查不到流水（流水功能上线前的老订单 / 退款已删除 sale 流水）时，
 * 调用方回退显示商品实时库存（现状行为）。
 */
export type SaleStockSnapshotIndex = ReadonlyMap<string, number>;

/** 流水索引键：`${saleOrderId}:${productId}` */
export const buildSaleStockKey = (
  saleOrderId: number,
  productId: number,
): string => `${saleOrderId}:${productId}`;

/**
 * 按展示行构建「销售时点库存」索引。
 * 同订单同商品在流水中可能存在多条（历史实现未合并），取 id 最大
 * （最后一条）的 afterStock，即本单该商品扣减完成后的库存。
 */
export const loadSaleStockSnapshotIndex = async (
  prisma: { inventoryAdjustmentLog: InventoryAdjustmentLogQueryClient },
  items: readonly OrderItemRow[],
): Promise<SaleStockSnapshotIndex> => {
  const saleOrderIds = new Set<number>();
  const productIds = new Set<number>();
  for (const item of items) {
    const productId = item.product?.id;
    if (!productId) continue;
    saleOrderIds.add(item.order.id);
    productIds.add(productId);
  }
  if (saleOrderIds.size === 0 || productIds.size === 0) {
    return new Map();
  }

  const logs = await prisma.inventoryAdjustmentLog.findMany({
    where: {
      saleOrderId: { in: [...saleOrderIds] },
      productId: { in: [...productIds] },
      adjustType: 'sale',
    },
    orderBy: { id: 'asc' },
    select: {
      saleOrderId: true,
      productId: true,
      afterStock: true,
    },
  });

  const index = new Map<string, number>();
  for (const log of logs) {
    if (log.saleOrderId == null || log.productId == null) continue;
    index.set(
      buildSaleStockKey(log.saleOrderId, log.productId),
      log.afterStock,
    );
  }
  return index;
};

/**
 * 按「商品当前库存 + 该行之后本班同商品销量」倒推销售时点库存，
 * 为查不到流水的行（流水功能上线前的老订单 / 被退款删除的流水）兜底：
 * 当前库存即本班最后一次销售后的库存，往前逐行加上后续销量即得各行销售后库存。
 *
 * 已有精确流水的行不受影响（preciseIndex 值优先保留）。
 *
 * 局限：班次窗口内若发生进货/盘点/其他渠道扣减，倒推值会整体偏移；
 * 退款单行不参与展示（前端隐藏）但其销量会计入后续行的推算。
 */
export const buildSaleStockSnapshotIndex = (
  items: readonly OrderItemRow[],
  preciseIndex: SaleStockSnapshotIndex,
): SaleStockSnapshotIndex => {
  const index = new Map<string, number>(preciseIndex);

  const rowsByProduct = new Map<number, OrderItemRow[]>();
  for (const item of items) {
    const productId = item.product?.id;
    if (!productId) continue;
    const group = rowsByProduct.get(productId) ?? [];
    group.push(item);
    rowsByProduct.set(productId, group);
  }

  for (const [productId, rows] of rowsByProduct) {
    const sorted = [...rows].sort((left, right) => {
      const byDate = left.order.date.getTime() - right.order.date.getTime();
      return byDate !== 0 ? byDate : left.id - right.id;
    });

    // 从最后一行往前倒推：laterQuantitySum = 该行之后本班同商品销量之和
    let laterQuantitySum = 0;
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const row = sorted[i];
      const key = buildSaleStockKey(row.order.id, productId);
      if (!index.has(key)) {
        const currentStock = row.product?.stock;
        if (currentStock != null) {
          index.set(key, currentStock + laterQuantitySum);
        }
      }
      laterQuantitySum += Math.max(row.quantity, 0);
    }
  }
  return index;
};
