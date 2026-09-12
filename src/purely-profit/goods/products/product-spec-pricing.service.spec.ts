import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  hashSpecSignature,
  ProductSpecPricingService,
} from './product-spec-pricing.service';

// ─── 测试夹具 ────────────────────────────────────────────────────────────
interface FixtureGroup {
  id: number;
  name: string;
  min: number;
  max: number | null;
  options: Array<{
    id: number;
    name: string;
    extra: number;
    isActive?: boolean;
  }>;
}

interface FixtureProduct {
  price?: number;
  costPrice?: number | null;
  name?: string;
  category?: string;
  groups?: FixtureGroup[];
}

const buildProduct = (fixture: FixtureProduct = {}) => ({
  id: 1,
  name: fixture.name ?? '拿铁',
  category: fixture.category ?? '咖啡',
  price: fixture.price ?? 1000,
  costPrice: fixture.costPrice === undefined ? 300 : fixture.costPrice,
  scanOrderingMenuProducts:
    fixture.groups === undefined
      ? []
      : [
          {
            id: 77,
            specGroups: fixture.groups.map((group) => ({
              id: group.id,
              name: group.name,
              minSelections: group.min,
              maxSelections: group.max,
              options: group.options.map((option) => ({
                id: option.id,
                name: option.name,
                extraPrice: option.extra,
                isActive: option.isActive ?? true,
              })),
            })),
          },
        ],
});

const buildPrisma = (product: unknown) =>
  ({
    product: { findFirst: jest.fn().mockResolvedValue(product) },
  }) as unknown as PrismaService;

const CUP_GROUP: FixtureGroup = {
  id: 1,
  name: '杯型',
  min: 1,
  max: 1,
  options: [
    { id: 11, name: '大杯', extra: 200 },
    { id: 12, name: '小杯', extra: 0 },
  ],
};

const TEMP_GROUP: FixtureGroup = {
  id: 2,
  name: '温度',
  min: 1,
  max: 1,
  options: [
    { id: 21, name: '热', extra: 0 },
    { id: 22, name: '冰', extra: -50 },
  ],
};

describe('ProductSpecPricingService', () => {
  it('无规格：单价取 Product.price，签名为 null，展示名即商品名', async () => {
    const service = new ProductSpecPricingService(
      buildPrisma(buildProduct({ price: 1000, costPrice: 300, groups: [] })),
    );

    const result = await service.price({
      storeId: 7,
      productId: 1,
      specOptionIds: [],
    });

    expect(result).toEqual({
      menuProductId: null,
      unitPriceCents: 1000,
      costPriceCents: 300,
      profitCents: 700,
      categoryName: '咖啡',
      specOptionIds: [],
      specNames: [],
      specOptions: [],
      specSignature: null,
      displayName: '拿铁',
    });
  });

  it('单规格：单价 = 基准价 + 该选项加价', async () => {
    const service = new ProductSpecPricingService(
      buildPrisma(
        buildProduct({ price: 1000, costPrice: 300, groups: [CUP_GROUP] }),
      ),
    );

    const result = await service.price({
      storeId: 7,
      productId: 1,
      specOptionIds: [11],
    });

    expect(result.unitPriceCents).toBe(1200);
    expect(result.profitCents).toBe(900);
    expect(result.specNames).toEqual(['大杯']);
    expect(result.displayName).toBe('拿铁（大杯）');
    expect(result.specSignature).toBe(hashSpecSignature([11]));
  });

  it('多规格：累加各组加价，规格名按组/选项顺序排列', async () => {
    const service = new ProductSpecPricingService(
      buildPrisma(
        buildProduct({
          price: 1000,
          costPrice: 300,
          groups: [CUP_GROUP, TEMP_GROUP],
        }),
      ),
    );

    const result = await service.price({
      storeId: 7,
      productId: 1,
      specOptionIds: [11, 21],
    });

    expect(result.unitPriceCents).toBe(1200);
    expect(result.specNames).toEqual(['大杯', '热']);
    expect(result.displayName).toBe('拿铁（大杯/热）');
  });

  it('选项越界：选项不属于该商品时拒绝', async () => {
    const service = new ProductSpecPricingService(
      buildPrisma(buildProduct({ groups: [CUP_GROUP] })),
    );

    await expect(
      service.price({ storeId: 7, productId: 1, specOptionIds: [11, 999] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('minSelect 未满足：必选组未选时拒绝', async () => {
    const service = new ProductSpecPricingService(
      buildPrisma(buildProduct({ groups: [CUP_GROUP, TEMP_GROUP] })),
    );

    // 只选了杯型，温度组 minSelections=1 未满足
    await expect(
      service.price({ storeId: 7, productId: 1, specOptionIds: [11] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('负加价：允许低于基准价，利润同步下降', async () => {
    const service = new ProductSpecPricingService(
      buildPrisma(
        buildProduct({
          price: 1000,
          costPrice: 300,
          groups: [CUP_GROUP, TEMP_GROUP],
        }),
      ),
    );

    const result = await service.price({
      storeId: 7,
      productId: 1,
      specOptionIds: [11, 22],
    });

    expect(result.unitPriceCents).toBe(1150);
    expect(result.profitCents).toBe(850);
    expect(result.displayName).toBe('拿铁（大杯/冰）');
  });

  it('商品不存在或已下架时抛 NotFoundException', async () => {
    const service = new ProductSpecPricingService(buildPrisma(null));

    await expect(
      service.price({ storeId: 7, productId: 1, specOptionIds: [] }),
    ).rejects.toThrow(NotFoundException);
  });

  it('选项顺序不影响签名，且签名与扫码点餐购物车同口径', async () => {
    const service = new ProductSpecPricingService(
      buildPrisma(buildProduct({ groups: [CUP_GROUP, TEMP_GROUP] })),
    );

    const ascending = await service.price({
      storeId: 7,
      productId: 1,
      specOptionIds: [11, 21],
    });
    const descending = await service.price({
      storeId: 7,
      productId: 1,
      specOptionIds: [21, 11],
    });

    expect(ascending.specSignature).toBe(descending.specSignature);
    expect(ascending.specSignature).toBe(hashSpecSignature([11, 21]));
  });
});
