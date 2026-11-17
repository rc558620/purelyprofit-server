import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScanOrderingUnpaidOrderClosureService } from '../src/purely-club/scan-ordering/scan-ordering-unpaid-order-closure.service';
import { ScanOrderingRealtimeService } from '../src/purely-club/scan-ordering/scan-ordering-realtime.service';

/**
 * 真实数据库 E2E：批量关单（closeBatch）的集合 SQL。
 *
 * `UPDATE scan_orders ... FROM (VALUES ...) ... RETURNING` 与两条明细查询都是原生 SQL，
 * mock 单测只能证明「执行了一次」，证明不了：列名 / 枚举字面量是否与库内一致、
 * VALUES 连接是否真能命中目标行、库存回补是否按「预留优先、不足再恢复」走对分支。
 * 这里在 Postgres 上跑一遍并断言副作用：
 * 1. 两笔 pending_payment 订单都变成 cancelled / closed，version +1；
 * 2. 支付尝试 created → closed、券占用 locked → released；
 * 3. 每笔订单恰好 1 条状态历史；
 * 4. 有预留的订单只释放 reserved_quantity，stock_quantity 不动；
 * 5. VALUES 的 version 前置条件生效：重复提交同一批（version 已变）不会二次关单。
 *
 * 额外用 `EXPLAIN (ANALYZE, BUFFERS)` 打印实际执行计划；UPDATE 的 ANALYZE 会真的
 * 写数据，因此在事务内执行并强制回滚，只取计划不落库。
 */
describe('扫码点餐批量关单 (e2e, real database)', () => {
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

  /** 用于「事务内 EXPLAIN 后强制回滚」的哨兵错误 */
  class ExplainRollback extends Error {}

  const realtimeStub = { publishOrderStatusChanged: jest.fn() };

  let prisma: PrismaService;
  let moduleFixture: TestingModule;
  let closureService: ScanOrderingUnpaidOrderClosureService;

  let storeId = 0;
  let sessionId = 0;
  let ownerUserId = 0;
  let clubUserId = 0;
  let categoryId = 0;
  let menuProductWithSpecId = 0;
  let menuProductFreeId = 0;
  let productId = 0;
  let specGroupId = 0;
  let specOptionId = 0;

  /** 有规格 + 绑定 Product 的订单（预留 3） */
  let orderWithSpecId = 0;
  /** 无规格的订单（菜单商品为不限库存口径） */
  let orderWithoutSpecId = 0;
  let orderWithSpecVersion = 0;

  const reason = '支付超时自动关闭';

  /**
   * 在事务内跑 `EXPLAIN (ANALYZE, BUFFERS)`：UPDATE 的 ANALYZE 会真的写数据，
   * 因此用哨兵异常强制回滚，只把计划文本带出来。
   * 同时 `SET LOCAL enable_seqscan = off`，让小表也走索引，证明索引确实可用
   * （否则几张空表上 PG 必然选 Seq Scan，计划里看不出索引是否存在）。
   */
  const explainAndPrint = async (
    title: string,
    sql: string,
  ): Promise<string> => {
    const marker = `EXPLAIN_PLAN:${title}`;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        const plan = await tx.$queryRawUnsafe<Array<Record<string, string>>>(
          `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
        );
        throw new ExplainRollback(
          `${marker}\n${plan
            .map((row) => Object.values(row)[0])
            .filter((line): line is string => typeof line === 'string')
            .join('\n')}`,
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith(marker)) {
        console.log(`\n===== ${title} =====\n${message}\n`);
        return message;
      }
      throw error;
    }
    throw new Error('EXPLAIN 未返回执行计划');
  };

  beforeAll(async () => {
    if (!configService.get('database.url')) {
      throw new Error('缺少 DATABASE_URL，无法运行真实数据库 E2E');
    }

    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        ScanOrderingUnpaidOrderClosureService,
        { provide: ScanOrderingRealtimeService, useValue: realtimeStub },
      ],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    closureService = moduleFixture.get(ScanOrderingUnpaidOrderClosureService);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const owner = await prisma.user.create({
      data: {
        email: `e2e-close-batch-owner-${suffix}@test.local`,
        password: 'x',
      },
    });
    ownerUserId = owner.id;

    const clubUser = await prisma.user.create({
      data: {
        email: `e2e-close-batch-club-${suffix}@test.local`,
        password: 'x',
      },
    });
    clubUserId = clubUser.id;

    const store = await prisma.store.create({
      data: {
        name: `E2E批量关单店${suffix}`,
        ownerId: owner.id,
        businessMode: 'general',
      },
      select: { id: true },
    });
    storeId = store.id;

    const diningRoundId = randomUUID();
    const session = await prisma.scanOrderingSession.create({
      data: {
        storeId,
        clubUserId,
        diningRoundId,
        session: `e2e-close-${suffix}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      select: { id: true },
    });
    sessionId = session.id;

    const category = await prisma.scanOrderingMenuCategory.create({
      data: { storeId, name: `热菜${suffix}`, sortOrder: 0 },
      select: { id: true },
    });
    categoryId = category.id;

    const product = await prisma.product.create({
      data: {
        storeId,
        category: '默认',
        code: `E2E-${suffix}`,
        name: '绑定商品',
        price: 100,
        profit: 10,
        unit: '份',
        stock: 100,
      },
      select: { id: true },
    });
    productId = product.id;

    // 有规格：有限库存 + 预留 3（订单项 3 件），只有「释放预留」分支能命中
    const menuProductWithSpec = await prisma.scanOrderingMenuProduct.create({
      data: {
        storeId,
        categoryId,
        productId,
        name: `烤鱼${suffix}`,
        basePrice: 8800,
        stockMode: 'finite',
        stockQuantity: 10,
        reservedQuantity: 3,
        salesCount: 0,
      },
      select: { id: true },
    });
    menuProductWithSpecId = menuProductWithSpec.id;

    // 无规格：不限库存口径，回补时两条分支都应落空（stock_mode != finite）
    const menuProductFree = await prisma.scanOrderingMenuProduct.create({
      data: {
        storeId,
        categoryId,
        name: `餐位费${suffix}`,
        basePrice: 200,
        stockMode: 'unlimited',
      },
      select: { id: true },
    });
    menuProductFreeId = menuProductFree.id;

    const specGroup = await prisma.scanOrderingSpecGroup.create({
      data: {
        menuProductId: menuProductWithSpecId,
        name: '辣度',
        sortOrder: 0,
      },
      select: { id: true },
    });
    specGroupId = specGroup.id;

    const specOption = await prisma.scanOrderingSpecOption.create({
      data: {
        groupId: specGroupId,
        name: '微辣',
        extraPrice: 0,
        stockQuantity: 8,
        reservedQuantity: 3,
        sortOrder: 0,
      },
      select: { id: true },
    });
    specOptionId = specOption.id;

    const baseOrder = {
      storeId,
      sessionId,
      clubUserId,
      diningRoundId,
      status: 'pending_payment' as const,
      paymentStatus: 'unpaid' as const,
      fulfillmentStatus: 'preparing' as const,
      payableAmount: 0,
      paymentExpiresAt: new Date(Date.now() - 60_000),
      version: 0,
    };

    const orderWithSpec = await prisma.scanOrders.create({
      data: {
        ...baseOrder,
        orderNo: `E2E-CLOSE-A-${suffix}`,
        payableAmount: 26400,
      },
      select: { id: true },
    });
    orderWithSpecId = orderWithSpec.id;

    const orderWithoutSpec = await prisma.scanOrders.create({
      data: {
        ...baseOrder,
        orderNo: `E2E-CLOSE-B-${suffix}`,
        payableAmount: 200,
      },
      select: { id: true },
    });
    orderWithoutSpecId = orderWithoutSpec.id;

    const itemWithSpec = await prisma.scanOrderItem.create({
      data: {
        orderId: orderWithSpecId,
        storeId,
        menuProductId: menuProductWithSpecId,
        productNameSnapshot: '烤鱼',
        quantity: 3,
        basePriceSnapshot: 8800,
        unitPriceAmount: 8800,
        lineTotalAmount: 26400,
        payableLineAmount: 26400,
      },
      select: { id: true },
    });

    await prisma.scanOrderItemSpec.create({
      data: {
        orderItemId: itemWithSpec.id,
        specOptionId,
        specOptionNameSnapshot: '微辣',
        extraPriceSnapshot: 0,
      },
    });

    await prisma.scanOrderItem.create({
      data: {
        orderId: orderWithoutSpecId,
        storeId,
        menuProductId: menuProductFreeId,
        productNameSnapshot: '餐位费',
        quantity: 1,
        basePriceSnapshot: 200,
        unitPriceAmount: 200,
        lineTotalAmount: 200,
        payableLineAmount: 200,
      },
    });

    // 在途支付尝试：关单后必须落 closed
    await prisma.scanOrderPaymentAttempt.createMany({
      data: [
        {
          orderId: orderWithSpecId,
          storeId,
          paymentChannel: 'wechat',
          merchantPaymentNo: `E2E-MP-A-${suffix}`,
          amount: 26400,
          status: 'paying',
        },
        {
          orderId: orderWithoutSpecId,
          storeId,
          paymentChannel: 'wechat',
          merchantPaymentNo: `E2E-MP-B-${suffix}`,
          amount: 200,
          status: 'created',
        },
      ],
    });

    // 券占用：locked → released
    await prisma.scanOrderCouponUsage.create({
      data: {
        orderId: orderWithSpecId,
        couponId: 990_000 + Math.floor(Math.random() * 9_000),
        clubUserId,
        storeId,
        discountAmount: 500,
        status: 'locked',
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      const orderIds = [orderWithSpecId, orderWithoutSpecId].filter(Boolean);
      await prisma.scanOrderStatusHistory.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.scanOrderCouponUsage.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.scanOrderPaymentAttempt.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      const itemIds = (
        await prisma.scanOrderItem.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((item) => item.id);
      await prisma.scanOrderItemSpec.deleteMany({
        where: { orderItemId: { in: itemIds } },
      });
      await prisma.scanOrderItem.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.scanOrders.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.scanOrderingSpecOption.deleteMany({
        where: { id: specOptionId },
      });
      await prisma.scanOrderingSpecGroup.deleteMany({
        where: { id: specGroupId },
      });
      await prisma.scanOrderingMenuProduct.deleteMany({
        where: { id: { in: [menuProductWithSpecId, menuProductFreeId] } },
      });
      await prisma.scanOrderingMenuCategory.deleteMany({
        where: { id: categoryId },
      });
      await prisma.product.deleteMany({ where: { id: productId } });
      await prisma.scanOrderingSession.deleteMany({ where: { id: sessionId } });
      await prisma.store.deleteMany({ where: { id: storeId } });
      await prisma.user.deleteMany({
        where: { id: { in: [ownerUserId, clubUserId].filter(Boolean) } },
      });
      await prisma.$disconnect();
    }
    await moduleFixture.close();
  });

  it('EXPLAIN：UPDATE ... FROM (VALUES) 与两条明细查询均可执行且用得上索引', async () => {
    const updatePlan = await explainAndPrint(
      '批量关单 UPDATE',
      `UPDATE "scan_orders" AS o
         SET "status" = 'cancelled',
             "fulfillment_status" = 'closed',
             "cancelled_at" = NOW() AT TIME ZONE 'UTC',
             "cancel_reason" = '${reason}',
             "version" = o."version" + 1,
             "updated_at" = NOW() AT TIME ZONE 'UTC'
         FROM (VALUES (${orderWithSpecId}::int, 0::int), (${orderWithoutSpecId}::int, 0::int))
           AS v(id, expected_version)
         WHERE o."id" = v.id
           AND o."version" = v.expected_version
           AND o."status" = 'pending_payment'
           AND o."payment_status" = 'unpaid'
         RETURNING o."id", o."store_id", o."session_id"`,
    );
    expect(updatePlan).toContain('scan_orders');

    const itemPlan = await explainAndPrint(
      '批量明细查询',
      `SELECT soi."id", soi."order_id", soi."store_id", soi."menu_product_id",
              soi."quantity", mp."product_id"
         FROM "scan_order_items" AS soi
         LEFT JOIN "scan_ordering_menu_products" AS mp
           ON mp."id" = soi."menu_product_id"
        WHERE soi."order_id" IN (${orderWithSpecId}, ${orderWithoutSpecId})`,
    );
    expect(itemPlan).toMatch(/Index Scan|Bitmap Index Scan/);

    const specPlan = await explainAndPrint(
      '批量规格快照查询',
      `SELECT sos."order_item_id", sos."spec_option_id"
         FROM "scan_order_item_specs" AS sos
         JOIN "scan_order_items" AS soi ON soi."id" = sos."order_item_id"
        WHERE soi."order_id" IN (${orderWithSpecId}, ${orderWithoutSpecId})`,
    );
    expect(specPlan).toMatch(/Index Scan|Bitmap Index Scan/);
  });

  it('closeBatch：两笔订单关闭、库存只释放预留、支付尝试/券/历史全部同步', async () => {
    const before = await prisma.scanOrders.findUniqueOrThrow({
      where: { id: orderWithSpecId },
      select: { version: true },
    });
    orderWithSpecVersion = before.version;

    const closed = await closureService.closeBatch(
      [
        { orderId: orderWithSpecId, expectedVersion: before.version },
        { orderId: orderWithoutSpecId, expectedVersion: 0 },
      ],
      { operatorType: 'system', reason },
    );

    expect(closed).toHaveLength(2);
    expect(closed.map((item) => item.orderId).sort()).toEqual(
      [orderWithSpecId, orderWithoutSpecId].sort(),
    );
    expect(realtimeStub.publishOrderStatusChanged).toHaveBeenCalledTimes(2);

    const orders = await prisma.scanOrders.findMany({
      where: { id: { in: [orderWithSpecId, orderWithoutSpecId] } },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        version: true,
        cancelledAt: true,
        cancelReason: true,
      },
    });
    for (const order of orders) {
      expect(order.status).toBe('cancelled');
      expect(order.paymentStatus).toBe('unpaid');
      expect(order.fulfillmentStatus).toBe('closed');
      expect(order.version).toBe(before.version + 1);
      expect(order.cancelReason).toBe(reason);
      expect(order.cancelledAt).not.toBeNull();
    }

    const attempts = await prisma.scanOrderPaymentAttempt.findMany({
      where: { orderId: { in: [orderWithSpecId, orderWithoutSpecId] } },
      select: { status: true },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts.every((attempt) => attempt.status === 'closed')).toBe(true);

    const usages = await prisma.scanOrderCouponUsage.findMany({
      where: { orderId: orderWithSpecId },
      select: { status: true, releasedAt: true },
    });
    expect(usages).toHaveLength(1);
    expect(usages[0]!.status).toBe('released');
    expect(usages[0]!.releasedAt).not.toBeNull();

    const histories = await prisma.scanOrderStatusHistory.findMany({
      where: { orderId: { in: [orderWithSpecId, orderWithoutSpecId] } },
      select: { orderId: true, fromStatus: true, toStatus: true, reason: true },
    });
    expect(histories).toHaveLength(2);
    for (const orderId of [orderWithSpecId, orderWithoutSpecId]) {
      const rows = histories.filter((row) => row.orderId === orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.fromStatus).toBe('pending_payment');
      expect(rows[0]!.toStatus).toBe('cancelled');
      expect(rows[0]!.reason).toBe(reason);
    }

    // 预留足额：只释放 reserved_quantity，stock_quantity / sales_count / 绑定商品库存都不动
    const menuProduct = await prisma.scanOrderingMenuProduct.findUniqueOrThrow({
      where: { id: menuProductWithSpecId },
      select: {
        reservedQuantity: true,
        stockQuantity: true,
        salesCount: true,
        version: true,
      },
    });
    expect(menuProduct.reservedQuantity).toBe(0);
    expect(menuProduct.stockQuantity).toBe(10);
    expect(menuProduct.salesCount).toBe(0);
    // 释放预留会 bump 菜单商品 version（与改造前 updateMany 一致）
    expect(menuProduct.version).toBe(1);

    const specOption = await prisma.scanOrderingSpecOption.findUniqueOrThrow({
      where: { id: specOptionId },
      select: { reservedQuantity: true, stockQuantity: true, version: true },
    });
    expect(specOption.reservedQuantity).toBe(0);
    expect(specOption.stockQuantity).toBe(8);
    expect(specOption.version).toBe(1);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { stock: true },
    });
    expect(product.stock).toBe(100);

    // 不限库存口径：两条回补分支都不得改写该行
    const freeProduct = await prisma.scanOrderingMenuProduct.findUniqueOrThrow({
      where: { id: menuProductFreeId },
      select: { reservedQuantity: true, stockQuantity: true, version: true },
    });
    expect(freeProduct.reservedQuantity).toBe(0);
    expect(freeProduct.stockQuantity).toBeNull();
    expect(freeProduct.version).toBe(0);
  });

  it('closeBatch：version 前置条件生效，重复提交同一批不会二次关单', async () => {
    const closed = await closureService.closeBatch(
      [
        { orderId: orderWithSpecId, expectedVersion: orderWithSpecVersion },
        { orderId: orderWithoutSpecId, expectedVersion: 0 },
      ],
      { operatorType: 'system', reason },
    );

    expect(closed).toEqual([]);
    // 不得重复写状态历史
    const historyCount = await prisma.scanOrderStatusHistory.count({
      where: { orderId: { in: [orderWithSpecId, orderWithoutSpecId] } },
    });
    expect(historyCount).toBe(2);
  });
});
