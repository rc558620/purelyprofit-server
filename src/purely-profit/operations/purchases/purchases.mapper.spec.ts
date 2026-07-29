import {
  buildEmptyPaginatedPurchasesResponse,
  buildEmptyPurchaseStatsResponse,
  buildPurchaseStatsResponse,
  mapPreviewPurchaseResponse,
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
      totalAmount: 7200,
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
          unitPrice: 1200,
          amount: 7200,
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
        currentTotalAmount: 20000,
        previousTotalAmount: 16000,
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
              unitPrice: 1200,
              amount: 3600,
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

  it('mapPreviewPurchaseResponse 会映射预览明细与合计金额', () => {
    expect(
      mapPreviewPurchaseResponse({
        items: [
          {
            productId: 201,
            productName: '可口可乐 330ml',
            unit: '箱',
            quantity: 6,
            unitPrice: 1200,
            amount: 7200,
          },
          {
            productId: null,
            productName: '散装辣条',
            unit: null,
            quantity: 3,
            unitPrice: 1200,
            amount: 3600,
          },
        ],
        totalAmount: 10800,
      }),
    ).toEqual({
      items: [
        {
          productId: '201',
          productName: '可口可乐 330ml',
          unit: '箱',
          quantity: 6,
          unitPrice: 12,
          amount: 72,
        },
        {
          productName: '散装辣条',
          quantity: 3,
          unitPrice: 12,
          amount: 36,
        },
      ],
      totalAmount: 108,
    });
  });
});
