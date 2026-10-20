import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingPricingVersionService } from './scan-ordering-pricing-version.service';
import type { PricingVersionSnapshot } from './scan-ordering-pricing-version.service';

const SESSION_ID = 77;

/** 本服务自行取数的形态（select 精确字段）。 */
const cartItemRows = [
  {
    id: 11,
    version: 3,
    quantity: 2,
    menuProductId: 21,
    specs: [{ specOptionId: 31 }, { specOptionId: 32 }],
  },
  { id: 12, version: 1, quantity: 1, menuProductId: 22, specs: [] },
];

const productRows = [
  {
    id: 21,
    version: 7,
    basePrice: 3800,
    isActive: true,
    stockMode: 'finite',
    stockQuantity: 10,
    specGroups: [
      {
        id: 41,
        version: 2,
        selectionType: 'single',
        minSelections: 1,
        maxSelections: 1,
        isActive: true,
        options: [
          {
            id: 31,
            version: 2,
            extraPrice: 100,
            isActive: true,
            stockQuantity: 5,
          },
          // 已失效但仍在购物车行里：不进商品的规格组过滤，但必须进 hash
          {
            id: 32,
            version: 1,
            extraPrice: 0,
            isActive: false,
            stockQuantity: null,
          },
          {
            id: 33,
            version: 4,
            extraPrice: 200,
            isActive: true,
            stockQuantity: null,
          },
        ],
      },
      {
        id: 42,
        version: 1,
        selectionType: 'multiple',
        minSelections: 0,
        maxSelections: null,
        isActive: true,
        options: [],
      },
    ],
  },
  {
    id: 22,
    version: 2,
    basePrice: 1200,
    isActive: true,
    stockMode: 'unlimited',
    stockQuantity: null,
    specGroups: [],
  },
];

const specOptionRows = [
  { id: 31, version: 2, extraPrice: 100, isActive: true, stockQuantity: 5 },
  { id: 32, version: 1, extraPrice: 0, isActive: false, stockQuantity: null },
];

/**
 * priceCart 形态的快照：同样的字段但带 ORM include 出来的冗余列
 * （name / category / reservedQuantity / sortOrder 等），用于验证
 * 「复用 priceCart 取数」不会改变 hash 输入。
 */
const pricedCartItems = cartItemRows.map((row) => ({
  ...row,
  sessionId: SESSION_ID,
  specSignature: '31,32',
  unitPriceAmount: 3900,
  lineTotalAmount: 7800,
  status: 'active',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  deletedAt: null,
  specs: row.specs.map((spec) => ({
    ...spec,
    id: spec.specOptionId,
    cartItemId: row.id,
    extraPriceSnapshot: 0,
  })),
}));

const pricedProducts = productRows.map((product) => ({
  ...product,
  storeId: 1,
  categoryId: 3,
  name: '测试商品',
  imageUrl: null,
  reservedQuantity: 0,
  sortOrder: 1,
  productId: null,
  category: { id: 3, name: '热菜' },
  product: null,
  specGroups: product.specGroups.map((group) => ({
    ...group,
    menuProductId: product.id,
    name: '规格组',
    sortOrder: 1,
    options: group.options.map((option) => ({
      ...option,
      groupId: group.id,
      name: '规格项',
      reservedQuantity: 0,
      sortOrder: 1,
      isDefault: false,
    })),
  })),
}));

describe('ScanOrderingPricingVersionService', () => {
  let service: ScanOrderingPricingVersionService;

  const prisma = {
    scanOrderingCartItem: { findMany: jest.fn() },
    scanOrderingMenuProduct: { findMany: jest.fn() },
    scanOrderingSpecOption: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.scanOrderingCartItem.findMany.mockResolvedValue(cartItemRows);
    prisma.scanOrderingMenuProduct.findMany.mockResolvedValue(productRows);
    prisma.scanOrderingSpecOption.findMany.mockResolvedValue(specOptionRows);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingPricingVersionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ScanOrderingPricingVersionService);
  });

  it('复用 priceCart 取数与自行取数产出同一个 pricingVersion', async () => {
    const selfLoaded = await service.computePricingVersion(SESSION_ID);
    const fromSnapshot = await service.computePricingVersion(SESSION_ID, {
      cartItems: pricedCartItems,
      products: pricedProducts,
    });

    expect(selfLoaded).toMatch(/^[0-9a-f]{64}$/);
    // 行序、商品序、规格序在 payload 里都被显式排序过，
    // 因此两种取数路径（select 精确字段 / include 全字段）必须逐字节一致
    expect(fromSnapshot).toBe(selfLoaded);
  });

  it('快照路径不再重查购物车行与商品，只保留规格项查询', async () => {
    await service.computePricingVersion(SESSION_ID, {
      cartItems: pricedCartItems,
      products: pricedProducts,
    });

    expect(prisma.scanOrderingCartItem.findMany).not.toHaveBeenCalled();
    expect(prisma.scanOrderingMenuProduct.findMany).not.toHaveBeenCalled();
    expect(prisma.scanOrderingSpecOption.findMany).toHaveBeenCalledTimes(1);
  });

  it('商品版本 / 价格变化仍然改变 pricingVersion（hash 维度未丢失）', async () => {
    const snapshot: PricingVersionSnapshot = {
      cartItems: pricedCartItems,
      products: pricedProducts,
    };
    const baseline = await service.computePricingVersion(SESSION_ID, snapshot);

    const bumpedVersion = await service.computePricingVersion(SESSION_ID, {
      ...snapshot,
      products: [
        { ...snapshot.products[0], version: 99 },
        ...snapshot.products.slice(1),
      ],
    });
    const changedPrice = await service.computePricingVersion(SESSION_ID, {
      ...snapshot,
      products: [
        { ...snapshot.products[0], basePrice: 1 },
        ...snapshot.products.slice(1),
      ],
    });
    const changedSpecVersion = await service.computePricingVersion(SESSION_ID, {
      ...snapshot,
      cartItems: [
        { ...snapshot.cartItems[0], version: 8 },
        ...snapshot.cartItems.slice(1),
      ],
    });

    expect(bumpedVersion).not.toBe(baseline);
    expect(changedPrice).not.toBe(baseline);
    expect(changedSpecVersion).not.toBe(baseline);
  });

  it('购物车为空时两条路径都返回同一空车版本', async () => {
    prisma.scanOrderingCartItem.findMany.mockResolvedValue([]);

    const selfLoaded = await service.computePricingVersion(SESSION_ID);
    const fromSnapshot = await service.computePricingVersion(SESSION_ID, {
      cartItems: [],
      products: [],
    });

    expect(fromSnapshot).toBe(selfLoaded);
    expect(prisma.scanOrderingMenuProduct.findMany).not.toHaveBeenCalled();
  });
});
