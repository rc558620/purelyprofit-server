import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  buildBatchPrisma,
  buildPrisma,
  buildProduct,
  CUP_GROUP,
  TEMP_GROUP,
} from './product-spec-pricing.spec-helpers';
import {
  hashSpecSignature,
  ProductSpecPricingService,
} from './product-spec-pricing.service';

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

  describe('priceMany 批量定价', () => {
    it('一次查询返回多行，结果顺序与入参一致且共用同一份价格规则', async () => {
      const latte = {
        ...buildProduct({ price: 1000, groups: [CUP_GROUP] }),
        id: 1,
      };
      const cola = {
        ...buildProduct({
          name: '可乐',
          category: '酒水饮料',
          price: 800,
          groups: [],
        }),
        id: 2,
      };
      const { prisma, findMany } = buildBatchPrisma([latte, cola]);
      const service = new ProductSpecPricingService(prisma);

      const result = await service.priceMany(7, [
        { productId: 2, specOptionIds: [] },
        { productId: 1, specOptionIds: [11] },
      ]);

      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: [2, 1] },
            storeId: 7,
            isActive: true,
            deletedAt: null,
          },
        }),
      );
      expect(result.map((row) => row.unitPriceCents)).toEqual([800, 1200]);
      expect(result[1].displayName).toBe('拿铁（大杯）');
      expect(result[0].specSignature).toBeNull();
    });

    it('空购物车不查库', async () => {
      const { prisma, findMany } = buildBatchPrisma([]);
      const service = new ProductSpecPricingService(prisma);

      await expect(service.priceMany(7, [])).resolves.toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('重复商品 ID 去重查询，每行仍独立计算规格加价', async () => {
      const { prisma, findMany } = buildBatchPrisma([
        { ...buildProduct({ groups: [CUP_GROUP] }), id: 1 },
      ]);
      const service = new ProductSpecPricingService(prisma);

      const result = await service.priceMany(7, [
        { productId: 1, specOptionIds: [11] },
        { productId: 1, specOptionIds: [12] },
      ]);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: [1] } }),
        }),
      );
      expect(result.map((row) => row.unitPriceCents)).toEqual([1200, 1000]);
    });

    it('任一商品缺失或已下架时抛 NotFoundException', async () => {
      const { prisma } = buildBatchPrisma([
        { ...buildProduct({ groups: [] }), id: 1 },
      ]);
      const service = new ProductSpecPricingService(prisma);

      await expect(
        service.priceMany(7, [{ productId: 1 }, { productId: 999 }]),
      ).rejects.toThrow(NotFoundException);
    });

    it('规格越界仍按单条定价口径拒绝', async () => {
      const { prisma } = buildBatchPrisma([
        { ...buildProduct({ groups: [CUP_GROUP] }), id: 1 },
      ]);
      const service = new ProductSpecPricingService(prisma);

      await expect(
        service.priceMany(7, [{ productId: 1, specOptionIds: [999] }]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('priceManySettled 批量定价（逐行容错）', () => {
    /**
     * 与「逐行 price() + 各自 try/catch」逐字段等价：
     * 这里直接与 priceMany 的结果对照，任何价格口径分叉都会被断言打出来。
     */
    it('与 priceMany 逐字段等价：无规格 / 单规格 / 多规格组合', async () => {
      const latte = {
        ...buildProduct({
          price: 1000,
          costPrice: 300,
          groups: [CUP_GROUP, TEMP_GROUP],
        }),
        id: 1,
      };
      const cola = {
        ...buildProduct({
          name: '可乐',
          category: '酒水饮料',
          price: 800,
          costPrice: 200,
          groups: [],
        }),
        id: 2,
      };
      // latte 的两个规格组都是必选（min=1），所以每行必须把两组选齐
      const items = [
        { productId: 2, specOptionIds: [] },
        { productId: 1, specOptionIds: [11, 21] },
        { productId: 1, specOptionIds: [12, 22] },
      ];

      const { prisma, findMany } = buildBatchPrisma([latte, cola]);
      const service = new ProductSpecPricingService(prisma);

      const settled = await service.priceManySettled(7, items);
      const batch = await service.priceMany(7, items);

      expect(findMany).toHaveBeenCalledTimes(2);
      expect(settled).toHaveLength(3);
      settled.forEach((outcome, index) => {
        expect(outcome.ok).toBe(true);
        if (outcome.ok) {
          expect(outcome.value).toEqual(batch[index]);
        }
      });
      expect(settled.map((row) => row.ok && row.value.unitPriceCents)).toEqual([
        800, 1200, 950,
      ]);
    });

    it('单行商品不存在时只该行 ok=false，其余行仍算出正确价格', async () => {
      const latte = {
        ...buildProduct({ price: 1000, costPrice: 300, groups: [CUP_GROUP] }),
        id: 1,
      };
      const { prisma } = buildBatchPrisma([latte]);
      const service = new ProductSpecPricingService(prisma);

      const [missing, ok] = await service.priceManySettled(7, [
        { productId: 999 },
        { productId: 1, specOptionIds: [11] },
      ]);

      expect(missing.ok).toBe(false);
      expect(missing.ok === false && missing.error).toBeInstanceOf(
        NotFoundException,
      );
      expect(ok.ok).toBe(true);
      expect(ok.ok === true && ok.value.unitPriceCents).toBe(1200);
    });

    it('商品已下架/已删除（查询不到）按不存在处理', async () => {
      const { prisma, findMany } = buildBatchPrisma([]);
      const service = new ProductSpecPricingService(prisma);

      const [row] = await service.priceManySettled(7, [{ productId: 1 }]);

      // 下架/软删除通过 where 过滤，不会返回行
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: [1] },
            storeId: 7,
            isActive: true,
            deletedAt: null,
          },
        }),
      );
      expect(row.ok).toBe(false);
      expect(row.ok === false && row.error).toBeInstanceOf(NotFoundException);
    });

    it('规格选项非法时该行 ok=false 且异常类型与单条定价一致', async () => {
      const latte = {
        ...buildProduct({ price: 1000, costPrice: 300, groups: [CUP_GROUP] }),
        id: 1,
      };
      const { prisma } = buildBatchPrisma([latte]);
      const service = new ProductSpecPricingService(prisma);

      // 对照基准：批量单条调用走同一条 findMany 查询路径
      let singleError: unknown = null;
      try {
        await service.priceMany(7, [{ productId: 1, specOptionIds: [999] }]);
      } catch (error: unknown) {
        singleError = error;
      }
      const [row] = await service.priceManySettled(7, [
        { productId: 1, specOptionIds: [999] },
      ]);

      expect(singleError).toBeInstanceOf(BadRequestException);
      expect(row.ok).toBe(false);
      expect(row.ok === false && row.error).toBeInstanceOf(BadRequestException);
    });

    it('必选规格未选（无规格入参但商品配了必选组）也按单条定价口径拒绝', async () => {
      const latte = {
        ...buildProduct({ price: 1000, costPrice: 300, groups: [CUP_GROUP] }),
        id: 1,
      };
      const { prisma } = buildBatchPrisma([latte]);
      const service = new ProductSpecPricingService(prisma);

      const [row] = await service.priceManySettled(7, [{ productId: 1 }]);

      expect(row.ok).toBe(false);
      expect(row.ok === false && row.error).toBeInstanceOf(BadRequestException);
    });

    it('整批只查一次库；空数组不查库', async () => {
      const { prisma, findMany } = buildBatchPrisma([
        { ...buildProduct({ groups: [] }), id: 1 },
      ]);
      const service = new ProductSpecPricingService(prisma);

      await service.priceManySettled(7, [
        { productId: 1 },
        { productId: 1 },
        { productId: 1 },
      ]);
      expect(findMany).toHaveBeenCalledTimes(1);

      await expect(service.priceManySettled(7, [])).resolves.toEqual([]);
      expect(findMany).toHaveBeenCalledTimes(1);
    });
  });
});
