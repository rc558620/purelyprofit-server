// ProductSpecPricingService 单测共用的商品/规格夹具。
//
// 定价用例分两组（单条 + 批量），共用同一份夹具可避免两套 mock 结构漂移，
// 同时把 spec 文件控制在 400 行以内。
import type { PrismaService } from '../../../prisma/prisma.service';

export interface FixtureGroup {
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

export interface FixtureProduct {
  price?: number;
  costPrice?: number | null;
  name?: string;
  category?: string;
  groups?: FixtureGroup[];
}

export const buildProduct = (fixture: FixtureProduct = {}) => ({
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

export const buildPrisma = (product: unknown) =>
  ({
    product: {
      findFirst: jest.fn().mockResolvedValue(product),
      findMany: jest.fn().mockResolvedValue(product === null ? [] : [product]),
    },
  }) as unknown as PrismaService;

/** 批量定价夹具：单独暴露 findMany 桩，便于断言只查一次库 */
export const buildBatchPrisma = (products: unknown[]) => {
  const findMany = jest.fn().mockResolvedValue(products);
  return {
    prisma: {
      product: { findFirst: jest.fn(), findMany },
    } as unknown as PrismaService,
    findMany,
  };
};

/** 选择符合该商品规格的合法选项组合（两个必选组都要选齐） */
export const CUP_GROUP: FixtureGroup = {
  id: 1,
  name: '杯型',
  min: 1,
  max: 1,
  options: [
    { id: 11, name: '大杯', extra: 200 },
    { id: 12, name: '小杯', extra: 0 },
  ],
};

export const TEMP_GROUP: FixtureGroup = {
  id: 2,
  name: '温度',
  min: 1,
  max: 1,
  options: [
    { id: 21, name: '热', extra: 0 },
    { id: 22, name: '冰', extra: -50 },
  ],
};
