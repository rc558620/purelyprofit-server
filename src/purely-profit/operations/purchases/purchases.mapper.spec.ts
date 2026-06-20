import { Prisma } from '@prisma/client';
import {
  buildEmptyPaginatedPurchasesResponse,
  buildEmptyPurchaseStatsResponse,
  buildPaginatedPurchasesResponse,
  buildPurchaseStatsResponse,
  mapPurchaseResponse,
} from './purchases.mapper';
import type { PurchaseOrderWithItems } from './purchases.types';

describe('purchases.mapper', () => {
  function createOrder(
    overrides?: Partial<PurchaseOrderWithItems>,
  ): PurchaseOrderWithItems {
    const createdAt = new Date('2026-05-14T12:00:00.000Z');

    return {
      id: 11,
      storeId: 18,
      supplierId: 6,
      supplierName: '可口可乐供应商',
      operatorStaffId: 8,
      totalAmount: new Prisma.Decimal('72'),
      date: new Date('2026-05-14T10:00:00.000Z'),
      note: '门店周补货',
      createdAt,
      updatedAt: createdAt,
      items: [
        {
          id: 101,
          orderId: 11,
          storeId: 18,
          productId: 201,
          productName: '可口可乐 330ml 快照',
          unit: '箱',
          quantity: 6,
          unitPrice: new Prisma.Decimal('12'),
          amount: new Prisma.Decimal('72'),
          createdAt,
        },
      ],
      ...overrides,
    };
  }

  it('buildEmptyPaginatedPurchasesResponse 会返回空列表分页结构', () => {
    expect(buildEmptyPaginatedPurchasesResponse(2, 10)).toEqual({
      items: [],
      meta: {
        page: 2,
        pageSize: 10,
        total: 0,
        totalPages: 1,
      },
    });
  });

  it('buildEmptyPurchaseStatsResponse 会返回默认统计值', () => {
    expect(buildEmptyPurchaseStatsResponse()).toEqual({
      totalAmount: 0,
      orderCount: 0,
      supplierCount: 0,
      compareLastPeriod: null,
    });
  });

  it('buildPurchaseStatsResponse 会计算当前金额与环比', () => {
    expect(
      buildPurchaseStatsResponse({
        supplierCount: 3,
        currentCount: 4,
        currentTotalAmount: new Prisma.Decimal('200'),
        previousTotalAmount: new Prisma.Decimal('160'),
        hasPreviousRange: true,
      }),
    ).toEqual({
      totalAmount: 200,
      orderCount: 4,
      supplierCount: 3,
      compareLastPeriod: 25,
    });
  });

  it('mapPurchaseResponse 会映射订单并省略空可选字段', () => {
    expect(
      mapPurchaseResponse(
        createOrder({
          supplierId: null,
          supplierName: '临时供应商',
          note: null,
          items: [
            {
              id: 102,
              orderId: 11,
              storeId: 18,
              productId: null,
              productName: '散装辣条',
              unit: null,
              quantity: 3,
              unitPrice: new Prisma.Decimal('12'),
              amount: new Prisma.Decimal('36'),
              createdAt: new Date('2026-05-14T12:00:00.000Z'),
            },
          ],
        }),
      ),
    ).toEqual({
      id: '11',
      supplierName: '临时供应商',
      items: [
        {
          id: '102',
          productName: '散装辣条',
          quantity: 3,
          unitPrice: 12,
          amount: 36,
        },
      ],
      totalAmount: 72,
      date: new Date('2026-05-14T10:00:00.000Z').getTime(),
      createdAt: new Date('2026-05-14T12:00:00.000Z').getTime(),
    });
  });

  it('buildPaginatedPurchasesResponse 会映射列表和分页信息', () => {
    expect(buildPaginatedPurchasesResponse([createOrder()], 2, 1, 3)).toEqual({
      items: [
        {
          id: '11',
          supplierId: '6',
          supplierName: '可口可乐供应商',
          items: [
            {
              id: '101',
              productId: '201',
              productName: '可口可乐 330ml 快照',
              unit: '箱',
              quantity: 6,
              unitPrice: 12,
              amount: 72,
            },
          ],
          totalAmount: 72,
          date: new Date('2026-05-14T10:00:00.000Z').getTime(),
          note: '门店周补货',
          createdAt: new Date('2026-05-14T12:00:00.000Z').getTime(),
        },
      ],
      meta: {
        page: 2,
        pageSize: 1,
        total: 3,
        totalPages: 3,
      },
    });
  });
});
