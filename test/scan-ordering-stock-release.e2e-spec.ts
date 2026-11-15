import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  aggregateStockRelease,
  applyStockRelease,
} from '../src/purely-club/scan-ordering/scan-ordering-stock-release.helper';
import type { StockReleasePlan } from '../src/purely-club/scan-ordering/scan-ordering-stock-release.helper';

/**
 * 真实数据库 E2E：未支付订单关闭时的批量库存回补。
 *
 * 为什么必须用真库：helper 里的 UPDATE ... FROM (VALUES) / RETURNING 语义
 * （RETURNING 精确分组、enum 字面量比较、SUM 子查询、两次 UPDATE 之间的可见性、
 * NOW() AT TIME ZONE 'UTC' 写入 timestamptz）都无法由 mock 单测证明。
 * 其余非 Prisma 依赖不参与，只注入最小 ConfigService + PrismaService。
 */
describe('批量库存回补 (e2e, real database)', () => {
  const envConfig = new ConfigService();

  const configService = {
    get: (key: string): unknown => {
      switch (key) {
        case 'database.url':
          return envConfig.get<string>('DATABASE_URL');
        case 'database.poolMax':
          return 5;
        case 'database.poolMin':
          return 1;
        case 'database.poolIdleTimeoutMs':
          return 30_000;
        case 'database.poolConnectionTimeoutMs':
          return 5_000;
        case 'database.statementTimeoutMs':
          return 10_000;
        case 'database.pgMaxConnections':
          return 100;
        case 'app.slowQueryLogEnabled':
          return false;
        case 'app.slowQueryThresholdMs':
          return 80;
        case 'app.sqlMetricsEnabled':
          return false;
        case 'nodeEnv':
          return 'test';
        default:
          return undefined;
      }
    },
  } as ConfigService;

  let prisma: PrismaService;
  let moduleFixture: TestingModule;
  let storeId = 0;
  let userId = 0;
  let categoryId = 0;
  let productAId = 0;
  let productBId = 0;
  let menuAId = 0;
  let menuBId = 0;
  let groupId = 0;
  let optionFiniteId = 0;
  let optionUnlimitedId = 0;

  beforeAll(async () => {
    if (!configService.get('database.url')) {
      throw new Error('缺少 DATABASE_URL，无法运行真实数据库 E2E');
    }

    const moduleBuilder = Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
      ],
    });
    moduleFixture = await moduleBuilder.compile();
    prisma = moduleFixture.get(PrismaService);

    const suffix = `${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        email: `e2e-stock-${suffix}@test.local`,
        password: 'not-used',
      },
    });
    userId = user.id;

    const store = await prisma.store.create({
      data: {
        name: `E2E库存回补店${suffix}`,
        ownerId: user.id,
        businessMode: 'general',
      },
    });
    storeId = store.id;

    const category = await prisma.scanOrderingMenuCategory.create({
      data: { storeId, name: '测试分类' },
    });
    categoryId = category.id;

    const createPair = async (
      key: string,
      stockMode: 'finite' | 'unlimited',
    ): Promise<{ productId: number; menuId: number }> => {
      const product = await prisma.product.create({
        data: {
          storeId,
          category: '测试分类',
          code: `SR-${key}-${suffix}`,
          name: `商品${key}`,
          price: 1000,
          profit: 400,
          costPrice: 600,
          unit: '份',
          stock: 100,
        },
      });
      const menu = await prisma.scanOrderingMenuProduct.create({
        data: {
          storeId,
          categoryId,
          name: `菜单商品${key}`,
          basePrice: 1000,
          stockMode,
          stockQuantity: stockMode === 'finite' ? 50 : null,
          salesCount: 10,
          productId: product.id,
        },
      });
      return { productId: product.id, menuId: menu.id };
    };

    const pairA = await createPair('A', 'finite');
    productAId = pairA.productId;
    menuAId = pairA.menuId;
    const pairB = await createPair('B', 'unlimited');
    productBId = pairB.productId;
    menuBId = pairB.menuId;

    const group = await prisma.scanOrderingSpecGroup.create({
      data: { menuProductId: menuAId, name: '规格组' },
    });
    groupId = group.id;

    const finite = await prisma.scanOrderingSpecOption.create({
      data: {
        groupId,
        name: '有限库存选项',
        extraPrice: 0,
        stockQuantity: 20,
      },
    });
    optionFiniteId = finite.id;

    const unlimited = await prisma.scanOrderingSpecOption.create({
      data: {
        groupId,
        name: '不限库存选项',
        extraPrice: 0,
        stockQuantity: null,
      },
    });
    optionUnlimitedId = unlimited.id;
  });

  afterAll(async () => {
    await prisma.scanOrderingSpecOption.deleteMany({ where: { groupId } });
    await prisma.scanOrderingSpecGroup.deleteMany({
      where: { menuProductId: { in: [menuAId, menuBId] } },
    });
    await prisma.scanOrderingMenuProduct.deleteMany({ where: { storeId } });
    await prisma.scanOrderingMenuCategory.deleteMany({ where: { storeId } });
    await prisma.product.deleteMany({ where: { storeId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  /** 每个用例前把库存状态复位到同一基线，避免用例间互相污染 */
  const resetBaseline = async (params: {
    menuAReserved: number;
    menuBReserved?: number;
    optionReserved: number;
  }): Promise<void> => {
    await prisma.scanOrderingMenuProduct.update({
      where: { id: menuAId },
      data: {
        reservedQuantity: params.menuAReserved,
        stockQuantity: 50,
        salesCount: 10,
        version: 0,
      },
    });
    await prisma.scanOrderingMenuProduct.update({
      where: { id: menuBId },
      data: {
        reservedQuantity: params.menuBReserved ?? 0,
        stockQuantity: null,
        salesCount: 10,
        version: 0,
      },
    });
    await prisma.scanOrderingSpecOption.update({
      where: { id: optionFiniteId },
      data: {
        reservedQuantity: params.optionReserved,
        stockQuantity: 20,
        version: 0,
      },
    });
    await prisma.scanOrderingSpecOption.update({
      where: { id: optionUnlimitedId },
      data: { reservedQuantity: 0, stockQuantity: null, version: 0 },
    });
    await prisma.product.update({
      where: { id: productAId },
      data: { stock: 100 },
    });
    await prisma.product.update({
      where: { id: productBId },
      data: { stock: 100 },
    });
  };

  const runRelease = async (plan: StockReleasePlan): Promise<void> => {
    await prisma.$transaction((tx) => applyStockRelease(tx, storeId, plan));
  };

  const readMenu = (id: number) =>
    prisma.scanOrderingMenuProduct.findUniqueOrThrow({ where: { id } });
  const readOption = (id: number) =>
    prisma.scanOrderingSpecOption.findUniqueOrThrow({ where: { id } });
  const readProduct = (id: number) =>
    prisma.product.findUniqueOrThrow({ where: { id } });

  it('预留量足够时只释放预留，不恢复已扣减库存、不回补商品库', async () => {
    await resetBaseline({ menuAReserved: 5, optionReserved: 3 });
    const plan = aggregateStockRelease([
      {
        menuProductId: menuAId,
        quantity: 2,
        productId: productAId,
        specOptionIds: [optionFiniteId],
      },
    ]);

    await runRelease(plan);

    const menu = await readMenu(menuAId);
    const option = await readOption(optionFiniteId);
    const product = await readProduct(productAId);

    expect(menu.reservedQuantity).toBe(3);
    expect(menu.stockQuantity).toBe(50);
    expect(menu.salesCount).toBe(10);
    expect(menu.version).toBe(1);
    expect(option.reservedQuantity).toBe(1);
    expect(option.stockQuantity).toBe(20);
    expect(product.stock).toBe(100);
  });

  it('预留不足时恢复库存与销量、回补绑定商品库，且 updated_at 为 UTC 墙钟', async () => {
    await resetBaseline({ menuAReserved: 0, optionReserved: 0 });
    const plan = aggregateStockRelease([
      {
        menuProductId: menuAId,
        quantity: 2,
        productId: productAId,
        specOptionIds: [optionFiniteId],
      },
    ]);

    await runRelease(plan);

    const menu = await readMenu(menuAId);
    const option = await readOption(optionFiniteId);
    const product = await readProduct(productAId);

    expect(menu.reservedQuantity).toBe(0);
    expect(menu.stockQuantity).toBe(52);
    expect(menu.salesCount).toBe(8);
    expect(menu.version).toBe(1);
    expect(option.stockQuantity).toBe(22);
    expect(product.stock).toBe(102);
    // 若会话时区不是 UTC，NOW() AT TIME ZONE 'UTC' 会偏移 8 小时并被这里捕获
    expect(Math.abs(menu.updatedAt.getTime() - Date.now())).toBeLessThan(
      10_000,
    );
  });

  it('同一菜单商品多行聚合、规格跨行求和，unlimited 商品不参与恢复', async () => {
    await resetBaseline({
      menuAReserved: 5,
      menuBReserved: 0,
      optionReserved: 3,
    });
    const plan = aggregateStockRelease([
      {
        menuProductId: menuAId,
        quantity: 2,
        productId: productAId,
        specOptionIds: [optionFiniteId],
      },
      {
        menuProductId: menuAId,
        quantity: 3,
        productId: productAId,
        specOptionIds: [optionFiniteId],
      },
      {
        menuProductId: menuBId,
        quantity: 1,
        productId: productBId,
        specOptionIds: [],
      },
    ]);

    await runRelease(plan);

    const menuA = await readMenu(menuAId);
    const menuB = await readMenu(menuBId);
    const option = await readOption(optionFiniteId);
    const productA = await readProduct(productAId);
    const productB = await readProduct(productBId);

    // A 聚合为 5，预留 5 足够 → 只释放预留，库存与销量不变
    expect(menuA.reservedQuantity).toBe(0);
    expect(menuA.stockQuantity).toBe(50);
    expect(menuA.salesCount).toBe(10);
    // 规格聚合为 5，预留 3 不足 → 恢复库存
    expect(option.stockQuantity).toBe(25);
    expect(option.reservedQuantity).toBe(3);
    // B 是 unlimited：菜单恢复与商品库回补两条 SQL 都应跳过它
    expect(menuB.stockQuantity).toBeNull();
    expect(menuB.salesCount).toBe(10);
    expect(menuB.version).toBe(0);
    expect(productB.stock).toBe(100);
    expect(productA.stock).toBe(100);
  });

  it('stock_quantity 为 null 的规格不参与恢复，version 保持不变', async () => {
    await resetBaseline({ menuAReserved: 0, optionReserved: 0 });
    const plan = aggregateStockRelease([
      {
        menuProductId: menuAId,
        quantity: 1,
        productId: null,
        specOptionIds: [optionUnlimitedId],
      },
    ]);

    await runRelease(plan);

    const option = await readOption(optionUnlimitedId);
    expect(option.stockQuantity).toBeNull();
    expect(option.version).toBe(0);
  });

  it('空计划不产生任何写入', async () => {
    await resetBaseline({ menuAReserved: 0, optionReserved: 0 });

    await runRelease(aggregateStockRelease([]));

    const menu = await readMenu(menuAId);
    const product = await readProduct(productAId);
    expect(menu.stockQuantity).toBe(50);
    expect(menu.version).toBe(0);
    expect(product.stock).toBe(100);
  });
});
