import {
  buildSaleStockSnapshotIndex,
  loadSaleStockSnapshotIndex,
} from './handover-stock-snapshot';
import type { OrderItemRow } from './handover.types';

const buildItem = (
  id: number,
  saleOrderId: number,
  product: { id: number; stock: number } | null,
): OrderItemRow =>
  ({
    id,
    productName: '商品',
    salePrice: 1000,
    quantity: 1,
    product,
    order: {
      id: saleOrderId,
      date: new Date('2026-10-17T10:00:00+08:00'),
      paymentMethod: 'wechat',
      manualEntry: false,
      diningMode: null,
      sourceChannel: null,
      grouponCode: null,
      operatorNameSnapshot: null,
      operatorStaff: null,
      scanOrder: null,
      spaceSession: null,
    },
  }) as OrderItemRow;

const buildPrisma = (
  logs: Array<{
    saleOrderId: number | null;
    productId: number | null;
    afterStock: number;
  }>,
) => ({
  inventoryAdjustmentLog: {
    findMany: jest.fn().mockResolvedValue(logs),
  },
});

describe('handover-stock-snapshot', () => {
  it('按 saleOrderId+productId 取销售扣减后的库存（afterStock）', async () => {
    const prisma = buildPrisma([
      { saleOrderId: 66, productId: 101, afterStock: 6 },
      { saleOrderId: 67, productId: 101, afterStock: 5 },
    ]);

    const index = await loadSaleStockSnapshotIndex(prisma, [
      buildItem(1, 66, { id: 101, stock: 3 }),
      buildItem(2, 67, { id: 101, stock: 3 }),
    ]);

    expect(prisma.inventoryAdjustmentLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          saleOrderId: { in: [66, 67] },
          productId: { in: [101] },
          adjustType: 'sale',
        },
        orderBy: { id: 'asc' },
      }),
    );
    expect(index.get('66:101')).toBe(6);
    expect(index.get('67:101')).toBe(5);
  });

  it('同订单同商品多条流水时取最后一条（id 最大）的 afterStock', async () => {
    const prisma = buildPrisma([
      { saleOrderId: 66, productId: 101, afterStock: 8 },
      { saleOrderId: 66, productId: 101, afterStock: 6 },
    ]);

    const index = await loadSaleStockSnapshotIndex(prisma, [
      buildItem(1, 66, { id: 101, stock: 3 }),
    ]);

    expect(index.get('66:101')).toBe(6);
  });

  it('无商品关联的行不参与查询，返回空索引', async () => {
    const prisma = buildPrisma([]);

    const index = await loadSaleStockSnapshotIndex(prisma, [
      buildItem(1, 66, null),
    ]);

    expect(index.size).toBe(0);
    expect(prisma.inventoryAdjustmentLog.findMany).not.toHaveBeenCalled();
  });

  describe('buildSaleStockSnapshotIndex（无流水倒推兜底）', () => {
    it('无流水时按当前库存 + 后续销量倒推，同商品行呈递减序列', () => {
      // 当前库存 3（本班最后一笔卖完后剩 3）：三笔各卖 1
      // → 最早行卖后 5、中间 4、最后 3（5 → 4 → 3 递减）
      const earlier = buildItem(1, 66, { id: 101, stock: 3 });
      earlier.order.date = new Date('2026-10-17T10:00:00+08:00');
      const middle = buildItem(2, 67, { id: 101, stock: 3 });
      middle.order.date = new Date('2026-10-17T10:05:00+08:00');
      const later = buildItem(3, 68, { id: 101, stock: 3 });
      later.order.date = new Date('2026-10-17T10:10:00+08:00');

      const index = buildSaleStockSnapshotIndex(
        [earlier, middle, later],
        new Map(),
      );

      expect(index.get('66:101')).toBe(5);
      expect(index.get('67:101')).toBe(4);
      expect(index.get('68:101')).toBe(3);
    });

    it('多数量行按 quantity 累加倒推', () => {
      const row = buildItem(1, 66, { id: 101, stock: 5 });
      row.quantity = 3;
      const earlierRow = buildItem(2, 65, { id: 101, stock: 5 });
      earlierRow.order.date = new Date('2026-10-17T09:00:00+08:00');

      const index = buildSaleStockSnapshotIndex([earlierRow, row], new Map());

      // 当前库存 5 = 最后一笔（卖3）后的库存；更早一行卖后 = 5 + 3
      expect(index.get('66:101')).toBe(5);
      expect(index.get('65:101')).toBe(8);
    });

    it('精确流水优先生效，倒推不覆盖', () => {
      const item = buildItem(1, 66, { id: 101, stock: 3 });

      const index = buildSaleStockSnapshotIndex(
        [item],
        new Map([['66:101', 6]]),
      );

      expect(index.get('66:101')).toBe(6);
    });

    it('无商品关联的行不参与倒推', () => {
      const item = buildItem(1, 66, null);

      const index = buildSaleStockSnapshotIndex([item], new Map());

      expect(index.size).toBe(0);
    });
  });
});
