import { Prisma } from '@prisma/client';
import {
  PURCHASE_ORDER_WITH_ITEMS_INCLUDE,
  type PurchaseOrderWithItems,
} from './purchases.types';
import {
  aggregatePreviousPurchaseOrders,
  aggregatePurchaseOrders,
  countPurchaseOrders,
  countPurchaseSuppliers,
  createPurchaseOrderEntity,
  deletePurchaseOrderEntity,
  findPurchaseOrderAccessRecord,
  findPurchaseSupplier,
  queryPurchaseOrders,
  queryPurchaseProducts,
} from './purchases.query';

describe('purchases.query', () => {
  function createPrismaMock() {
    const purchaseOrderFindMany = jest.fn();
    const purchaseOrderCount = jest.fn();
    const purchaseOrderAggregate = jest.fn();
    const purchaseOrderFindUnique = jest.fn();
    const purchaseOrderDelete = jest.fn();
    const supplierCount = jest.fn();
    const supplierFindFirst = jest.fn();
    const productFindMany = jest.fn();

    return {
      prisma: {
        purchaseOrder: {
          findMany: purchaseOrderFindMany,
          count: purchaseOrderCount,
          aggregate: purchaseOrderAggregate,
          findUnique: purchaseOrderFindUnique,
          delete: purchaseOrderDelete,
        },
        supplier: {
          count: supplierCount,
          findFirst: supplierFindFirst,
        },
        product: {
          findMany: productFindMany,
        },
      },
      purchaseOrderFindMany,
      purchaseOrderCount,
      purchaseOrderAggregate,
      purchaseOrderFindUnique,
      purchaseOrderDelete,
      supplierCount,
      supplierFindFirst,
      productFindMany,
    };
  }

  function createTransactionMock() {
    const purchaseOrderCreate = jest.fn();

    return {
      transaction: {
        purchaseOrder: {
          create: purchaseOrderCreate,
        },
      } as unknown as Prisma.TransactionClient,
      purchaseOrderCreate,
    };
  }

  it('queryPurchaseOrders 会按统一 include 和排序查询进货单', async () => {
    const { prisma, purchaseOrderFindMany } = createPrismaMock();
    const createdAt = new Date('2026-05-14T12:00:00.000Z');
    const rows: PurchaseOrderWithItems[] = [
      {
        id: 11,
        storeId: 18,
        supplierId: 6,
        supplierName: '可口可乐供应商',
        operatorStaffId: 8,
        totalAmount: 7200,
        date: new Date('2026-05-14T10:00:00.000Z'),
        note: '门店周补货',
        createdAt,
        updatedAt: createdAt,
        items: [],
      },
    ];
    purchaseOrderFindMany.mockResolvedValue(rows);

    await expect(
      queryPurchaseOrders(prisma as never, {
        where: { storeId: 18 },
        skip: 2,
        take: 10,
      }),
    ).resolves.toEqual(rows);

    expect(purchaseOrderFindMany).toHaveBeenCalledWith({
      where: { storeId: 18 },
      include: PURCHASE_ORDER_WITH_ITEMS_INCLUDE,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: 2,
      take: 10,
    });
  });

  it('countPurchaseOrders 和 countPurchaseSuppliers 会转发统计查询', async () => {
    const { prisma, purchaseOrderCount, supplierCount, purchaseOrderFindMany } =
      createPrismaMock();
    purchaseOrderCount.mockResolvedValue(6);
    supplierCount.mockResolvedValue(3);
    purchaseOrderFindMany.mockResolvedValue([
      { supplierId: 1 },
      { supplierId: 2 },
    ]);

    await expect(
      countPurchaseOrders(prisma as never, { storeId: 18 }),
    ).resolves.toBe(6);
    // 无 where 参数时回退到全量供应商计数
    await expect(countPurchaseSuppliers(prisma as never, 18)).resolves.toBe(3);
    // 有 where 参数时按筛选周期统计有进货记录的供应商数
    await expect(
      countPurchaseSuppliers(prisma as never, 18, { storeId: 18 }),
    ).resolves.toBe(2);

    expect(purchaseOrderCount).toHaveBeenCalledWith({ where: { storeId: 18 } });
    expect(supplierCount).toHaveBeenCalledWith({ where: { storeId: 18 } });
    expect(purchaseOrderFindMany).toHaveBeenCalledWith({
      where: { storeId: 18 },
      select: { supplierId: true },
      distinct: ['supplierId'],
    });
  });

  it('aggregatePurchaseOrders 会按统一聚合结构查询', async () => {
    const { prisma, purchaseOrderAggregate } = createPrismaMock();
    purchaseOrderAggregate.mockResolvedValue({
      _count: { id: 4 },
      _sum: { totalAmount: 20000 },
    });

    await expect(
      aggregatePurchaseOrders(prisma as never, { storeId: 18 }),
    ).resolves.toEqual({
      _count: { id: 4 },
      _sum: { totalAmount: 20000 },
    });

    expect(purchaseOrderAggregate).toHaveBeenCalledWith({
      where: { storeId: 18 },
      _count: { id: true },
      _sum: { totalAmount: true },
    });
  });

  it('aggregatePreviousPurchaseOrders 在缺少上一期区间时返回空聚合结果', async () => {
    const { prisma, purchaseOrderAggregate } = createPrismaMock();

    await expect(
      aggregatePreviousPurchaseOrders(prisma as never, { storeId: 18 }),
    ).resolves.toEqual({
      _sum: { totalAmount: null },
    });

    expect(purchaseOrderAggregate).not.toHaveBeenCalled();
  });

  it('aggregatePreviousPurchaseOrders 会按上一期日期范围聚合', async () => {
    const { prisma, purchaseOrderAggregate } = createPrismaMock();
    const previousRange = {
      gte: new Date(1715472000000),
      lte: new Date(1715558399999),
    };
    purchaseOrderAggregate.mockResolvedValue({
      _sum: { totalAmount: 16000 },
    });

    await expect(
      aggregatePreviousPurchaseOrders(prisma as never, {
        storeId: 18,
        previousRange,
      }),
    ).resolves.toEqual({
      _sum: { totalAmount: 16000 },
    });

    expect(purchaseOrderAggregate).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        date: previousRange,
      },
      _sum: { totalAmount: true },
    });
  });

  it('findPurchaseSupplier 会按门店过滤供应商并限制返回字段', async () => {
    const { prisma, supplierFindFirst } = createPrismaMock();
    supplierFindFirst.mockResolvedValue({ id: 6, name: '可口可乐供应商' });

    await expect(
      findPurchaseSupplier(prisma as never, { storeId: 18, supplierId: 6 }),
    ).resolves.toEqual({
      id: 6,
      name: '可口可乐供应商',
    });

    expect(supplierFindFirst).toHaveBeenCalledWith({
      where: {
        id: 6,
        storeId: 18,
      },
      select: {
        id: true,
        name: true,
      },
    });
  });

  it('queryPurchaseProducts 在没有商品 ID 时直接返回空数组', async () => {
    const { prisma, productFindMany } = createPrismaMock();

    await expect(
      queryPurchaseProducts(prisma as never, { storeId: 18, productIds: [] }),
    ).resolves.toEqual([]);

    expect(productFindMany).not.toHaveBeenCalled();
  });

  it('queryPurchaseProducts 会按门店和商品 ID 查询商品快照源数据', async () => {
    const { prisma, productFindMany } = createPrismaMock();
    productFindMany.mockResolvedValue([
      { id: 201, name: '可口可乐 330ml', unit: '瓶' },
    ]);

    await expect(
      queryPurchaseProducts(prisma as never, {
        storeId: 18,
        productIds: [201],
      }),
    ).resolves.toEqual([{ id: 201, name: '可口可乐 330ml', unit: '瓶' }]);

    expect(productFindMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        id: { in: [201] },
      },
      select: {
        id: true,
        name: true,
        unit: true,
      },
    });
  });

  it('createPurchaseOrderEntity 会创建订单和明细并带上统一 include', async () => {
    const { transaction, purchaseOrderCreate } = createTransactionMock();
    const createdAt = new Date('2026-05-14T12:00:00.000Z');
    purchaseOrderCreate.mockResolvedValue({
      id: 11,
      storeId: 18,
      supplierId: 6,
      supplierName: '可口可乐供应商',
      operatorStaffId: 8,
      totalAmount: 7200,
      date: new Date('2026-05-14T10:00:00.000Z'),
      note: '门店周补货',
      createdAt,
      updatedAt: createdAt,
      items: [],
    });

    await createPurchaseOrderEntity(transaction, {
      storeId: 18,
      supplierId: 6,
      supplierName: '可口可乐供应商',
      operatorStaffId: 8,
      totalAmount: 72,
      date: new Date('2026-05-14T10:00:00.000Z'),
      note: '门店周补货',
      items: [
        {
          productId: 201,
          productName: '可口可乐 330ml 快照',
          unit: '箱',
          quantity: 6,
          unitPrice: 12,
          amount: 72,
        },
      ],
    });

    expect(purchaseOrderCreate).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        supplierId: 6,
        supplierName: '可口可乐供应商',
        operatorStaffId: 8,
        totalAmount: 72,
        date: new Date('2026-05-14T10:00:00.000Z'),
        note: '门店周补货',
        items: {
          create: [
            {
              storeId: 18,
              productId: 201,
              productName: '可口可乐 330ml 快照',
              unit: '箱',
              quantity: 6,
              unitPrice: 12,
              amount: 72,
            },
          ],
        },
      },
      include: PURCHASE_ORDER_WITH_ITEMS_INCLUDE,
    });
  });

  it('findPurchaseOrderAccessRecord 和 deletePurchaseOrderEntity 会操作进货单主表', async () => {
    const { prisma, purchaseOrderFindUnique, purchaseOrderDelete } =
      createPrismaMock();
    purchaseOrderFindUnique.mockResolvedValue({ id: 11, storeId: 18 });

    await expect(
      findPurchaseOrderAccessRecord(prisma as never, 11),
    ).resolves.toEqual({ id: 11, storeId: 18 });
    await deletePurchaseOrderEntity(prisma as never, 11);

    expect(purchaseOrderFindUnique).toHaveBeenCalledWith({
      where: { id: 11 },
      select: {
        id: true,
        storeId: true,
      },
    });
    expect(purchaseOrderDelete).toHaveBeenCalledWith({
      where: { id: 11 },
    });
  });
});
