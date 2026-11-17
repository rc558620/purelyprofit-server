import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { ClubScanOrderingMenuQueryService } from '../src/purely-club/scan-ordering/club-scan-ordering-menu-query.service';
import { ClubScanOrderingMenuStockService } from '../src/purely-club/scan-ordering/club-scan-ordering-menu-stock.service';

/**
 * 真实数据库 E2E：扫码点餐菜单版本指纹（库内 md5 摘要）。
 *
 * 这段逻辑是一条原生 SQL，mock 单测只能证明「调用了一次 $queryRaw」，
 * 证明不了 SQL 本身可执行、`string_agg(... ORDER BY ...)` 是否确定、
 * 以及指纹维度是否覆盖分类/商品/规格组/规格项。这里在 Postgres 上断言：
 * 1. 空门店版本稳定（空集 md5），不会返回 null/undefined；
 * 2. 内容不变时重复计算得到同一版本（排序确定，不随执行计划抖动）；
 * 3. 上下架 / 名称 / 价格变化都会改变版本（内容进指纹，不依赖写路径 bump）；
 * 4. **version 与 reserved_quantity 变化不改变版本** —— 库存预留会 bump
 *    version，若它进指纹，一笔下单就会让整店菜单缓存 key 轮换（击穿点）。
 *    库存改由 ClubScanOrderingMenuStockService 的 5s 快照覆盖，这条契约固定
 *    下来防止有人往指纹里重新加回动态列；
 * 5. 菜单响应体结构不变（分类 → 商品 → 规格组），库存仍按「总量 - 预留」输出。
 */
describe('扫码点餐菜单版本指纹 (e2e, real database)', () => {
  const envConfig = new ConfigService();

  const configService = {
    get: (key: string): unknown => {
      switch (key) {
        case 'database.url':
          return envConfig.get<string>('DATABASE_URL');
        case 'database.poolMax':
          return 10;
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

  /** 空菜单指纹 = md5('')，SQL 里由 COALESCE 兜底 */
  const EMPTY_MENU_FINGERPRINT = 'd41d8cd98f00b204e9800998ecf8427e';

  interface MenuResponse {
    menuVersion: string;
    categories: Array<{
      id: number;
      name: string;
      products: Array<{
        id: number;
        name: string;
        basePrice: number;
        stockQuantity: number | null;
        specGroups: Array<{
          id: number;
          options: Array<{ id: number; stockQuantity: number | null }>;
        }>;
      }>;
    }>;
  }

  let prisma: PrismaService;
  let moduleFixture: TestingModule;
  let menuService: ClubScanOrderingMenuQueryService;

  let storeId = 0;
  let emptyStoreId = 0;
  let categoryId = 0;
  let productId = 0;
  let optionId = 0;
  let sessionId = 0;
  let emptyStoreSessionId = 0;
  let clubUserId = 0;
  let ownerUserId = 0;
  let emptyOwnerUserId = 0;

  /** 版本缓存/菜单缓存全部视为未命中：每次都会真的重算指纹 */
  const redisStub = {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve(undefined)),
    getJson: jest.fn(() => Promise.resolve(null)),
    setJson: jest.fn(() => Promise.resolve(undefined)),
    del: jest.fn(() => Promise.resolve(undefined)),
  };

  const loadMenu = async (targetSessionId: number): Promise<MenuResponse> =>
    (await menuService.getMenu(
      { id: clubUserId } as never,
      targetSessionId,
    )) as MenuResponse;

  beforeAll(async () => {
    if (!configService.get('database.url')) {
      throw new Error('缺少 DATABASE_URL，无法运行真实数据库 E2E');
    }

    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        ClubScanOrderingMenuQueryService,
        ClubScanOrderingMenuStockService,
        { provide: RedisService, useValue: redisStub },
      ],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    menuService = moduleFixture.get(ClubScanOrderingMenuQueryService);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const owner = await prisma.user.create({
      data: { email: `e2e-menu-version-${suffix}@test.local`, password: 'x' },
    });
    ownerUserId = owner.id;

    const clubUser = await prisma.user.create({
      data: {
        email: `e2e-menu-version-club-${suffix}@test.local`,
        password: 'x',
      },
    });
    clubUserId = clubUser.id;

    const store = await prisma.store.create({
      data: {
        name: `E2E菜单版本店${suffix}`,
        ownerId: owner.id,
        businessMode: 'general',
      },
    });
    storeId = store.id;

    // store.owner_id 唯一：空菜单门店必须用另一个 owner
    const emptyOwner = await prisma.user.create({
      data: {
        email: `e2e-menu-version-empty-${suffix}@test.local`,
        password: 'x',
      },
    });
    emptyOwnerUserId = emptyOwner.id;

    const emptyStore = await prisma.store.create({
      data: {
        name: `E2E空菜单店${suffix}`,
        ownerId: emptyOwner.id,
        businessMode: 'general',
      },
    });
    emptyStoreId = emptyStore.id;

    const expiresAt = new Date(Date.now() + 3_600_000);
    const session = await prisma.scanOrderingSession.create({
      data: {
        storeId,
        clubUserId,
        diningRoundId: randomUUID(),
        session: `e2e-${suffix}`,
        expiresAt,
      },
      select: { id: true },
    });
    sessionId = session.id;

    const emptySession = await prisma.scanOrderingSession.create({
      data: {
        storeId: emptyStoreId,
        clubUserId,
        diningRoundId: randomUUID(),
        session: `e2e-empty-${suffix}`,
        expiresAt,
      },
      select: { id: true },
    });
    emptyStoreSessionId = emptySession.id;

    const category = await prisma.scanOrderingMenuCategory.create({
      data: { storeId, name: '招牌菜', sortOrder: 0 },
      select: { id: true },
    });
    categoryId = category.id;

    const product = await prisma.scanOrderingMenuProduct.create({
      data: {
        storeId,
        categoryId,
        name: '烤鱼',
        basePrice: 8800,
        stockMode: 'finite',
        stockQuantity: 10,
        reservedQuantity: 2,
      },
      select: { id: true },
    });
    productId = product.id;

    const group = await prisma.scanOrderingSpecGroup.create({
      data: { menuProductId: productId, name: '辣度', sortOrder: 0 },
      select: { id: true },
    });
    const option = await prisma.scanOrderingSpecOption.create({
      data: {
        groupId: group.id,
        name: '微辣',
        extraPrice: 0,
        stockQuantity: 5,
        reservedQuantity: 1,
        sortOrder: 0,
      },
      select: { id: true },
    });
    optionId = option.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (optionId) {
        await prisma.scanOrderingSpecOption.deleteMany({
          where: { id: optionId },
        });
      }
      await prisma.scanOrderingSpecGroup.deleteMany({
        where: { menuProductId: productId },
      });
      if (productId) {
        await prisma.scanOrderingMenuProduct.deleteMany({
          where: { id: productId },
        });
      }
      if (categoryId) {
        await prisma.scanOrderingMenuCategory.deleteMany({
          where: { id: categoryId },
        });
      }
      await prisma.scanOrderingSession.deleteMany({
        where: { id: { in: [sessionId, emptyStoreSessionId].filter(Boolean) } },
      });
      await prisma.store.deleteMany({
        where: { id: { in: [storeId, emptyStoreId].filter(Boolean) } },
      });
      await prisma.user.deleteMany({
        where: {
          id: {
            in: [ownerUserId, emptyOwnerUserId, clubUserId].filter(Boolean),
          },
        },
      });
      await prisma.$disconnect();
    }
    await moduleFixture.close();
  });

  it('空门店：版本为稳定的空集 md5，不返回空值', async () => {
    const first = await loadMenu(emptyStoreSessionId);
    const second = await loadMenu(emptyStoreSessionId);

    expect(first.menuVersion).toBe(EMPTY_MENU_FINGERPRINT);
    expect(second.menuVersion).toBe(EMPTY_MENU_FINGERPRINT);
    expect(first.categories).toEqual([]);
  });

  it('内容不变时重复计算得到同一版本（排序确定，不随执行计划抖动）', async () => {
    const first = await loadMenu(sessionId);
    const second = await loadMenu(sessionId);
    const third = await loadMenu(sessionId);

    expect(first.menuVersion).toMatch(/^[0-9a-f]{32}$/);
    expect(second.menuVersion).toBe(first.menuVersion);
    expect(third.menuVersion).toBe(first.menuVersion);
  });

  it('分类 version 变化不改变版本（version 已移出指纹）', async () => {
    const before = await loadMenu(sessionId);

    await prisma.scanOrderingMenuCategory.update({
      where: { id: categoryId },
      data: { version: { increment: 1 } },
    });

    const after = await loadMenu(sessionId);
    expect(after.menuVersion).toBe(before.menuVersion);
  });

  it('商品上下架会改变版本（is_active 进指纹）', async () => {
    const before = await loadMenu(sessionId);

    await prisma.scanOrderingMenuProduct.update({
      where: { id: productId },
      data: { isActive: false },
    });

    const after = await loadMenu(sessionId);
    expect(after.menuVersion).not.toBe(before.menuVersion);

    await prisma.scanOrderingMenuProduct.update({
      where: { id: productId },
      data: { isActive: true },
    });
  });

  it('规格项 version 变化不改变版本（下单预留不再轮换整店菜单 key）', async () => {
    const before = await loadMenu(sessionId);

    // 下单预留库存走的就是 bump 规格项 version + reserved_quantity
    await prisma.scanOrderingSpecOption.update({
      where: { id: optionId },
      data: { version: { increment: 1 } },
    });

    const after = await loadMenu(sessionId);
    expect(after.menuVersion).toBe(before.menuVersion);
  });

  it('商品 version / 预留量变化不改变版本（库存走 5s 快照）', async () => {
    const before = await loadMenu(sessionId);

    await prisma.scanOrderingMenuProduct.update({
      where: { id: productId },
      data: { version: { increment: 1 }, reservedQuantity: { increment: 1 } },
    });

    const after = await loadMenu(sessionId);
    expect(after.menuVersion).toBe(before.menuVersion);

    await prisma.scanOrderingMenuProduct.update({
      where: { id: productId },
      data: { reservedQuantity: { decrement: 1 } },
    });
  });

  it('名称 / 价格变化直接改变版本（内容进指纹，不依赖写路径 bump）', async () => {
    const before = await loadMenu(sessionId);

    await prisma.scanOrderingMenuProduct.update({
      where: { id: productId },
      data: { name: '改名即换键', basePrice: 9900 },
    });

    const after = await loadMenu(sessionId);
    expect(after.menuVersion).not.toBe(before.menuVersion);
  });

  it('菜单响应体结构不变：分类 → 商品 → 规格组，库存仍按「总量 - 预留」输出', async () => {
    const menu = await loadMenu(sessionId);

    expect(menu.categories).toHaveLength(1);
    expect(menu.categories[0].name).toBe('招牌菜');
    expect(menu.categories[0].products).toHaveLength(1);

    const product = menu.categories[0].products[0];
    expect(product.basePrice).toBe(9900);
    expect(product.stockQuantity).toBe(8);

    expect(product.specGroups).toHaveLength(1);
    expect(product.specGroups[0].options[0].stockQuantity).toBe(4);
  });
});
