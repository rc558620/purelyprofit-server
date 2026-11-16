import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { ClubScanOrderingCartService } from '../src/purely-club/scan-ordering/club-scan-ordering-cart.service';
import type { AuthenticatedUser } from '../src/purely-profit/auth/strategies/jwt.strategy';

/**
 * 真实数据库 E2E：扫码点餐购物车「加购」的原子写入。
 *
 * 为什么必须用真库：加购已从「交互式事务 + 捕获 P2002 重试」改为单条
 * `INSERT ... ON CONFLICT DO UPDATE`（含 CTE 联写规格行），以下语义无法由 mock 证明：
 *  - 部分唯一索引 `uq_scan_ordering_cart_item_active` 的推断谓词是否与索引逐字匹配
 *    （不匹配时 PostgreSQL 直接报错，不会静默降级）；
 *  - 并发首次加购同一规格时，是否收敛成单行并把数量累加正确（原实现靠异常重试）；
 *  - 规格行 upsert 是否复用同一行、`extra_price_snapshot` 是否随加购刷新。
 */
describe('扫码点餐购物车原子写入 (e2e, real database)', () => {
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
  let service: ClubScanOrderingCartService;
  let user: AuthenticatedUser;

  let storeId = 0;
  let userId = 0;
  let categoryId = 0;
  let productId = 0;
  let menuProductId = 0;
  let plainMenuProductId = 0;
  let groupId = 0;
  let optionId = 0;

  beforeAll(async () => {
    if (!configService.get('database.url')) {
      throw new Error('缺少 DATABASE_URL，无法运行真实数据库 E2E');
    }

    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
      ],
    }).compile();
    prisma = moduleFixture.get(PrismaService);

    // 会员到期校验与购物车写入无关，用 stub 隔离，避免引入平台会员链路
    const downgradeStub = {
      assertStoreCanOrder: (): Promise<void> => Promise.resolve(),
    };
    service = new ClubScanOrderingCartService(prisma, downgradeStub as never);

    const suffix = `${Date.now()}`;
    const created = await prisma.user.create({
      data: { email: `e2e-cart-${suffix}@test.local`, password: 'not-used' },
    });
    userId = created.id;
    user = { id: userId } as AuthenticatedUser;

    const store = await prisma.store.create({
      data: {
        name: `E2E购物车店${suffix}`,
        ownerId: userId,
        businessMode: 'general',
      },
    });
    storeId = store.id;

    const category = await prisma.scanOrderingMenuCategory.create({
      data: { storeId, name: '测试分类' },
    });
    categoryId = category.id;

    const product = await prisma.product.create({
      data: {
        storeId,
        category: '测试分类',
        code: `CART-${suffix}`,
        name: '测试商品',
        price: 1000,
        profit: 400,
        costPrice: 600,
        unit: '份',
        stock: 100,
      },
    });
    productId = product.id;

    const menu = await prisma.scanOrderingMenuProduct.create({
      data: {
        storeId,
        categoryId,
        name: '带规格菜单商品',
        basePrice: 1000,
        stockMode: 'unlimited',
        salesCount: 0,
        productId,
      },
    });
    menuProductId = menu.id;

    const plainMenu = await prisma.scanOrderingMenuProduct.create({
      data: {
        storeId,
        categoryId,
        name: '无规格菜单商品',
        basePrice: 800,
        stockMode: 'unlimited',
        salesCount: 0,
      },
    });
    plainMenuProductId = plainMenu.id;

    const group = await prisma.scanOrderingSpecGroup.create({
      data: {
        menuProductId,
        name: '杯型',
        minSelections: 1,
        maxSelections: 1,
      },
    });
    groupId = group.id;

    const option = await prisma.scanOrderingSpecOption.create({
      data: { groupId, name: '大杯', extraPrice: 300, stockQuantity: null },
    });
    optionId = option.id;
  });

  afterAll(async () => {
    await prisma.scanOrderingCartItem.deleteMany({
      where: { session: { storeId } },
    });
    await prisma.scanOrderingSession.deleteMany({ where: { storeId } });
    await prisma.scanOrderingSpecOption.deleteMany({ where: { groupId } });
    await prisma.scanOrderingSpecGroup.deleteMany({ where: { menuProductId } });
    await prisma.scanOrderingMenuProduct.deleteMany({ where: { storeId } });
    await prisma.scanOrderingMenuCategory.deleteMany({ where: { storeId } });
    await prisma.product.deleteMany({ where: { storeId } });
    await prisma.store.deleteMany({ where: { id: storeId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  /** 每个用例一条独立会话，避免购物车行互相污染 */
  const createSession = async (): Promise<number> => {
    const session = await prisma.scanOrderingSession.create({
      data: {
        storeId,
        clubUserId: userId,
        diningRoundId: randomUUID(),
        session: randomUUID(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
      select: { id: true },
    });
    return session.id;
  };

  const loadRows = (sessionId: number, targetProductId: number) =>
    prisma.scanOrderingCartItem.findMany({
      where: {
        sessionId,
        menuProductId: targetProductId,
        status: 'active',
        deletedAt: null,
      },
      select: {
        id: true,
        quantity: true,
        unitPriceAmount: true,
        lineTotalAmount: true,
        version: true,
        specs: { select: { specOptionId: true, extraPriceSnapshot: true } },
      },
    });

  it('首次加购（有规格）：写入一行并落规格快照', async () => {
    const sessionId = await createSession();

    await service.addCartItem(user, {
      sessionId,
      productId: menuProductId,
      specOptionIds: [optionId],
      quantity: 2,
    } as never);

    const rows = await loadRows(sessionId, menuProductId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      quantity: 2,
      // 1000 基础价 + 300 规格加价
      unitPriceAmount: 1300,
      lineTotalAmount: 2600,
      version: 1,
    });
    expect(rows[0].specs).toEqual([
      { specOptionId: optionId, extraPriceSnapshot: 300 },
    ]);
  });

  it('同规格重复加购：复用同一行并累加，版本递增，规格行不重复', async () => {
    const sessionId = await createSession();

    for (let index = 0; index < 3; index += 1) {
      await service.addCartItem(user, {
        sessionId,
        productId: menuProductId,
        specOptionIds: [optionId],
        quantity: 1,
      } as never);
    }

    const rows = await loadRows(sessionId, menuProductId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      quantity: 3,
      lineTotalAmount: 3900,
      version: 3,
    });
    expect(rows[0].specs).toHaveLength(1);
  });

  it('并发首次加购同一规格：收敛为单行且数量累加正确', async () => {
    const sessionId = await createSession();
    const concurrency = 5;

    await Promise.all(
      Array.from({ length: concurrency }, () =>
        service.addCartItem(user, {
          sessionId,
          productId: menuProductId,
          specOptionIds: [optionId],
          quantity: 1,
        } as never),
      ),
    );

    const rows = await loadRows(sessionId, menuProductId);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(concurrency);
    expect(rows[0].specs).toHaveLength(1);
  });

  it('无规格商品：只写行、不产生规格行', async () => {
    const sessionId = await createSession();

    await service.addCartItem(user, {
      sessionId,
      productId: plainMenuProductId,
      specOptionIds: [],
      quantity: 4,
    } as never);

    const rows = await loadRows(sessionId, plainMenuProductId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      quantity: 4,
      unitPriceAmount: 800,
      lineTotalAmount: 3200,
    });
    expect(rows[0].specs).toEqual([]);
  });
});
