import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { ProductSpecPricingService } from '../../goods/products/product-spec-pricing.service';
import type { SessionItemPayloadInput } from './space-session-payload.shared';
import type { SpaceSessionItemDto } from './dto/space-session-items.request.dto';
import { SpaceSessionWriteService } from './space-session-write.service';

/**
 * 追加点单的定价回退语义（收银加单主链路）。
 *
 * 这里守护的是「批量定价改造不能改变对外行为」：
 * - 无规格行商品缺失/下架 → 回退前端传值（不抛错，历史行为）；
 * - 有规格行商品缺失/下架 → 必须抛错（不能静默丢弃规格）；
 * - 虚拟行（manual_ / SYS_）不参与定价，也不查库；
 * - 无论多少行，商品查询只有 1 次。
 */
describe('SpaceSessionWriteService 追加点单定价', () => {
  let service: SpaceSessionWriteService;

  const productFindMany = jest.fn();
  const prismaService = {
    product: { findMany: productFindMany },
  };

  const cacheInvalidatorService = {
    invalidateSpacesReadCaches: jest.fn(),
  };

  /** 规格宿主：一个必选杯型组（大杯 +2 元） */
  const latteRow = {
    id: 1,
    name: '拿铁',
    category: '咖啡',
    price: 1000,
    costPrice: 300,
    scanOrderingMenuProducts: [
      {
        id: 77,
        specGroups: [
          {
            id: 1,
            name: '杯型',
            minSelections: 1,
            maxSelections: 1,
            options: [
              { id: 11, name: '大杯', extraPrice: 200, isActive: true },
              { id: 12, name: '小杯', extraPrice: 0, isActive: true },
            ],
          },
        ],
      },
    ],
  };

  /** 触发私有定价方法：只测定价映射与回退分支，不牵入事务链路 */
  const priceItems = (
    items: SpaceSessionItemDto[],
  ): Promise<SessionItemPayloadInput[]> =>
    (
      service as unknown as {
        priceAppendedItems: (
          storeId: number,
          items: SpaceSessionItemDto[],
        ) => Promise<SessionItemPayloadInput[]>;
      }
    ).priceAppendedItems(18, items);

  const makeItem = (
    overrides: Partial<SpaceSessionItemDto> = {},
  ): SpaceSessionItemDto =>
    ({
      productId: '1',
      productName: '前端拿铁',
      categoryName: '咖啡',
      // 前端传值故意与权威价不同，用于验证「回退」还是「覆盖」
      salePrice: 9.9,
      profit: 4.4,
      quantity: 1,
      ...overrides,
    }) as SpaceSessionItemDto;

  beforeEach(async () => {
    jest.clearAllMocks();
    productFindMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionWriteService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: ProductSpecPricingService,
          useFactory: () =>
            new ProductSpecPricingService(
              prismaService as unknown as PrismaService,
            ),
        },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
      ],
    }).compile();

    service = module.get<SpaceSessionWriteService>(SpaceSessionWriteService);
  });

  it('无规格行商品不存在时回退前端传值，不抛错', async () => {
    const [row] = await priceItems([makeItem({ productId: '999' })]);

    expect(row.salePrice).toBe(9.9);
    expect(row.profit).toBe(4.4);
    expect(row.specSignature).toBeNull();
    expect(row.specNames).toBeNull();
  });

  it('有规格行商品不存在时必须抛错（不得静默丢弃规格）', async () => {
    await expect(
      priceItems([makeItem({ productId: '999', specOptionIds: [11] })]),
    ).rejects.toThrow(NotFoundException);
  });

  it('存在商品时用权威价覆盖前端传值，展示名带规格后缀', async () => {
    productFindMany.mockResolvedValueOnce([latteRow]);

    const [row] = await priceItems([
      makeItem({ productId: '1', specOptionIds: [11] }),
    ]);

    expect(row.salePrice).toBe(12);
    expect(row.profit).toBe(9);
    expect(row.productName).toBe('拿铁（大杯）');
    expect(row.specNames).toEqual(['大杯']);
  });

  it('manual_ / SYS_ 虚拟行不参与定价，且不触发商品查询', async () => {
    const rows = await priceItems([
      makeItem({ productId: 'manual_1' }),
      makeItem({ productId: 'SYS_2' }),
    ]);

    expect(productFindMany).not.toHaveBeenCalled();
    expect(rows.map((row) => row.salePrice)).toEqual([9.9, 9.9]);
  });

  it('多行混合时只查一次商品，且分别按各自商品定价', async () => {
    productFindMany.mockResolvedValueOnce([
      latteRow,
      {
        id: 2,
        name: '可乐',
        category: '酒水饮料',
        price: 800,
        costPrice: 200,
        scanOrderingMenuProducts: [],
      },
    ]);

    const rows = await priceItems([
      makeItem({ productId: '1', specOptionIds: [12] }),
      makeItem({ productId: '2' }),
      makeItem({ productId: 'manual_9' }),
    ]);

    expect(productFindMany).toHaveBeenCalledTimes(1);
    expect(rows.map((row) => row.salePrice)).toEqual([10, 8, 9.9]);
    expect(rows.map((row) => row.profit)).toEqual([7, 6, 4.4]);
  });

  it('无规格但商品配置了必选规格组时回退前端传值（保持历史行为）', async () => {
    productFindMany.mockResolvedValueOnce([latteRow]);

    const [row] = await priceItems([makeItem({ productId: '1' })]);

    expect(row.salePrice).toBe(9.9);
    expect(row.specSignature).toBeNull();
  });
});
