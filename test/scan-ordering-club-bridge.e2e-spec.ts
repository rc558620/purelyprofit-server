import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { ClubPaymentLockService } from '../src/purely-club/payments/club-payment-lock.service';
import { ScanOrderingRealtimeService } from '../src/purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingRefundService } from '../src/purely-club/scan-ordering/scan-ordering-refund.service';
import { ScanOrderingSaleOrderBridgeService } from '../src/purely-club/scan-ordering/scan-ordering-sale-order-bridge.service';
import { ClubScanOrderingPaymentService } from '../src/purely-club/scan-ordering/club-scan-ordering-payment.service';
import { CommerceAccessService } from '../src/purely-profit/commerce/commerce-access.service';
import { InventoryService } from '../src/purely-profit/goods/inventory/inventory.service';
import { CacheInvalidatorService } from '../src/redis/invalidator';
import { SalesRecordService } from '../src/purely-profit/operations/sales-record/sales-record.service';
import { SalesRecordReadService } from '../src/purely-profit/operations/sales-record/sales-record-read.service';
import { SalesRecordWriteService } from '../src/purely-profit/operations/sales-record/sales-record-write.service';
import { SalesRecordCreateFlowService } from '../src/purely-profit/operations/sales-record/sales-record-create-flow.service';
import { SalesRecordItemPreparationService } from '../src/purely-profit/operations/sales-record/sales-record-item-preparation.service';
import { SalesRecordPreviewService } from '../src/purely-profit/operations/sales-record/sales-record-preview.service';
import { SalesRecordRefundService } from '../src/purely-profit/operations/sales-record/sales-record-refund.service';
import { ScanOrderingOrderRefundBalanceService } from '../src/purely-profit/operations/scan-ordering/scan-ordering-order-refund-balance.service';
import { ScanOrderingRefundStockRestoreService } from '../src/purely-profit/operations/scan-ordering/scan-ordering-refund-stock-restore.service';
import { ScanOrderingOrderRefundHandlingService } from '../src/purely-profit/operations/scan-ordering/scan-ordering-order-refund.service';
import type { AuthenticatedUser } from '../src/purely-profit/auth/strategies/jwt.strategy';

/**
 * 真实数据库 E2E：扫码点餐 → 标准销售桥接 / 退款闭环 / 库存恢复 / 逐分对账。
 *
 * 依赖真实本地 PostgreSQL（DATABASE_URL），其余非 Prisma 依赖以最小 mock 注入，
 * 避免引入 Redis / 微信支付 / JWT 等外部链路。
 */
describe('ScanOrdering → SaleOrder bridge (e2e, real database)', () => {
  let prisma: PrismaService;
  let paymentService: ClubScanOrderingPaymentService;
  let refundHandlingService: ScanOrderingOrderRefundHandlingService;
  let moduleFixture: TestingModule;

  // completeRefund 内 resolveSingleStoreId 的返回门店，按用例切换
  let activeStoreId = 0;
  const createdStoreIds: number[] = [];
  const createdUserIds: number[] = [];

  const configService = {
    get: (key: string): unknown => {
      switch (key) {
        case 'database.url':
          return process.env.DATABASE_URL;
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

  const realtimeService = {
    publishOrderStatusChanged: jest.fn(),
  };

  const refundService = {
    createRefundTask: jest.fn(),
    createRefundTaskInTransaction: jest.fn(),
    markRefundTaskSucceededInTransaction: jest.fn(async () => undefined),
  };

  const inventoryService = {} as InventoryService;
  const cacheInvalidatorService = {
    invalidateSalesDerived: jest.fn(),
  } as unknown as CacheInvalidatorService;
  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(async () => activeStoreId),
    findOperatorStaffIdForStore: jest.fn(async () => null),
  } as unknown as CommerceAccessService;

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        SalesRecordItemPreparationService,
        SalesRecordCreateFlowService,
        SalesRecordWriteService,
        SalesRecordPreviewService,
        { provide: SalesRecordReadService, useValue: {} },
        SalesRecordService,
        SalesRecordRefundService,
        ScanOrderingRefundStockRestoreService,
        ScanOrderingSaleOrderBridgeService,
        ScanOrderingOrderRefundHandlingService,
        ClubScanOrderingPaymentService,
        { provide: InventoryService, useValue: inventoryService },
        { provide: CacheInvalidatorService, useValue: cacheInvalidatorService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: ScanOrderingRealtimeService, useValue: realtimeService },
        { provide: ScanOrderingRefundService, useValue: refundService },
        {
          provide: ScanOrderingOrderRefundBalanceService,
          useValue: {},
        },
        {
          provide: ClubPaymentLockService,
          useValue: {
            withOrderLock: jest.fn(
              async (_key: string, callback: () => Promise<unknown>) =>
                callback(),
            ),
          },
        },
      ],
    });

    moduleFixture = await moduleBuilder.compile();
    prisma = moduleFixture.get(PrismaService);
    await prisma.$connect();
    paymentService = moduleFixture.get(ClubScanOrderingPaymentService);
    refundHandlingService = moduleFixture.get(
      ScanOrderingOrderRefundHandlingService,
    );
  });

  afterAll(async () => {
    for (const storeId of [...createdStoreIds].reverse()) {
      await prisma.financeCashFlowRecord.deleteMany({ where: { storeId } });
      await prisma.saleOrderRefund.deleteMany({ where: { storeId } });
      await prisma.saleOrderItem.deleteMany({ where: { storeId } });
      await prisma.saleOrder.deleteMany({ where: { storeId } });
      await prisma.scanOrderStatusHistory.deleteMany({ where: { storeId } });
      await prisma.scanOrderPaymentAttempt.deleteMany({ where: { storeId } });
      await prisma.scanOrderItem.deleteMany({ where: { storeId } });
      await prisma.scanOrders.deleteMany({ where: { storeId } });
      await prisma.scanOrderingMenuProduct.deleteMany({ where: { storeId } });
      await prisma.scanOrderingMenuCategory.deleteMany({ where: { storeId } });
      await prisma.scanOrderingTable.deleteMany({ where: { storeId } });
      await prisma.product.deleteMany({ where: { storeId } });
      await prisma.store.deleteMany({ where: { id: storeId } });
    }
    for (const userId of [...createdUserIds].reverse()) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  let seq = 0;
  const nextSeq = () => ++seq;

  async function seedStoreAndMenu(): Promise<{
    storeId: number;
    tableId: number;
    categoryId: number;
    products: Record<string, { productId: number; menuProductId: number }>;
  }> {
    const s = nextSeq();
    const suffix = `${Date.now()}-${s}`;
    const user = await prisma.user.create({
      data: {
        email: `e2e-bridge-${suffix}@test.local`,
        password: 'not-used',
      },
    });
    createdUserIds.push(user.id);
    const store = await prisma.store.create({
      data: {
        name: `E2E桥接店${suffix}`,
        ownerId: user.id,
        businessMode: 'catering',
      },
    });
    createdStoreIds.push(store.id);
    const table = await prisma.scanOrderingTable.create({
      data: { storeId: store.id, tableCode: `T${suffix}`, name: '1号桌' },
    });
    const category = await prisma.scanOrderingMenuCategory.create({
      data: { storeId: store.id, name: '热菜' },
    });

    const createMenuProduct = async (
      key: string,
      opts: { name: string; priceCents: number; costCents: number },
    ): Promise<{ productId: number; menuProductId: number }> => {
      const product = await prisma.product.create({
        data: {
          storeId: store.id,
          category: '热菜',
          code: `P-${key}-${suffix}`,
          name: opts.name,
          price: opts.priceCents,
          profit: opts.priceCents - opts.costCents,
          costPrice: opts.costCents,
          unit: '份',
          stock: 10,
        },
      });
      const menuProduct = await prisma.scanOrderingMenuProduct.create({
        data: {
          storeId: store.id,
          categoryId: category.id,
          name: opts.name,
          basePrice: opts.priceCents,
          stockMode: 'finite',
          stockQuantity: 10,
          productId: product.id,
        },
      });
      return { productId: product.id, menuProductId: menuProduct.id };
    };

    const products: Record<
      string,
      { productId: number; menuProductId: number }
    > = {};
    products.alpha = await createMenuProduct('alpha', {
      name: '招牌小炒',
      priceCents: 2500,
      costCents: 2000,
    });
    products.beta = await createMenuProduct('beta', {
      name: '凉拌黄瓜',
      priceCents: 1200,
      costCents: 700,
    });
    return {
      storeId: store.id,
      tableId: table.id,
      categoryId: category.id,
      products,
    };
  }

  async function seedScanOrder(params: {
    storeId: number;
    tableId: number;
    items: Array<{
      menuProductId: number;
      name: string;
      quantity: number;
      payableLineAmount: number;
    }>;
    payableAmount: number;
  }): Promise<{ orderId: number; version: number }> {
    const s = nextSeq();
    const orderNo = `SO-E2E-${Date.now()}-${s}`;
    const order = await prisma.scanOrders.create({
      data: {
        storeId: params.storeId,
        tableId: params.tableId,
        orderNo,
        itemOriginalAmount: params.payableAmount,
        payableAmount: params.payableAmount,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        items: {
          create: params.items.map((item, index) => ({
            storeId: params.storeId,
            menuProductId: item.menuProductId,
            productNameSnapshot: item.name,
            quantity: item.quantity,
            basePriceSnapshot: item.payableLineAmount,
            unitPriceAmount: item.payableLineAmount,
            lineTotalAmount: item.payableLineAmount,
            payableLineAmount: item.payableLineAmount,
            sortOrder: index + 1,
          })),
        },
      },
      select: { id: true, version: true },
    });
    return { orderId: order.id, version: order.version };
  }

  async function seedPaymentAttempt(params: {
    orderId: number;
    storeId: number;
    amount: number;
  }): Promise<{ merchantPaymentNo: string }> {
    const merchantPaymentNo = `WX-E2E-${Date.now()}-${nextSeq()}`;
    await prisma.scanOrderPaymentAttempt.create({
      data: {
        orderId: params.orderId,
        storeId: params.storeId,
        paymentChannel: 'wechat',
        merchantPaymentNo,
        amount: params.amount,
        status: 'created',
      },
    });
    return { merchantPaymentNo };
  }

  const systemUser: AuthenticatedUser = {
    id: 0,
    email: 'system@scan-ordering.local',
    phone: '',
    name: '扫码点餐系统',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastActiveAt: null,
    currentMembership: null,
  };

  const merchantUser: AuthenticatedUser = {
    id: 1,
    email: 'merchant@test.local',
    phone: '13800138000',
    name: '商家',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    currentMembership: {
      staffId: 1,
      storeId: 0,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('正向支付：创建唯一销售单、逐分一致的财务流水与按成本推导的利润', async () => {
    const seed = await seedStoreAndMenu();
    activeStoreId = seed.storeId;
    const { orderId, version } = await seedScanOrder({
      storeId: seed.storeId,
      tableId: seed.tableId,
      payableAmount: 2500,
      items: [
        {
          menuProductId: seed.products.alpha.menuProductId,
          name: '招牌小炒',
          quantity: 1,
          payableLineAmount: 2500,
        },
      ],
    });
    const { merchantPaymentNo } = await seedPaymentAttempt({
      orderId,
      storeId: seed.storeId,
      amount: 2500,
    });

    const paidAt = Date.now();
    const result = await paymentService.confirmOrderPaidByCallback(
      merchantPaymentNo,
      {
        amountFen: 2500,
        transactionId: `txn-fwd-${Date.now()}-${nextSeq()}`,
        paidAtMs: paidAt,
        callbackReceivedAtMs: paidAt,
      },
    );

    expect(result.status).toBe('pending_acceptance');

    const saleOrder = await prisma.saleOrder.findUniqueOrThrow({
      where: { scanOrderId: orderId },
      include: { items: true, refund: true },
    });
    expect(saleOrder.totalRevenue).toBe(2500);
    expect(saleOrder.totalProfit).toBe(500); // 25 - 20 = 5 元
    expect(saleOrder.totalQuantity).toBe(1);
    expect(saleOrder.paymentMethod).toBe('wechat');
    expect(saleOrder.items).toHaveLength(1);
    expect(saleOrder.items[0].salePrice).toBe(2500);
    expect(saleOrder.items[0].profit).toBe(500);

    const cashFlow = await prisma.financeCashFlowRecord.findUniqueOrThrow({
      where: { saleOrderId: saleOrder.id },
    });
    expect(cashFlow.direction).toBe('income');
    expect(cashFlow.category).toBe('sales');
    expect(cashFlow.amount).toBe(2500);
    expect(cashFlow.payment).toBe('wechat');

    const paidOrder = await prisma.scanOrders.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(paidOrder.status).toBe('pending_acceptance');
    expect(paidOrder.paymentStatus).toBe('paid');
    expect(paidOrder.paidAmount).toBe(2500);
    expect(paidOrder.version).toBe(version + 1);
    // 幂等回调不会创建第二条销售单
    await paymentService.confirmOrderPaidByCallback(merchantPaymentNo, {
      amountFen: 2500,
      transactionId: `txn-fwd-idem-${Date.now()}-${nextSeq()}`,
      paidAtMs: paidAt + 1,
      callbackReceivedAtMs: paidAt + 1,
    });
    expect(
      await prisma.saleOrder.count({ where: { scanOrderId: orderId } }),
    ).toBe(1);
    expect(
      await prisma.financeCashFlowRecord.count({
        where: { saleOrderId: saleOrder.id },
      }),
    ).toBe(1);
  });

  it('逐分对账：多商品多数量按权重拆分后合计等于 payableAmount', async () => {
    const seed = await seedStoreAndMenu();
    activeStoreId = seed.storeId;
    // 3 份 × (100/3→34/33/33) + 2 份 × (50/2→25/25) = 150 分
    const { orderId } = await seedScanOrder({
      storeId: seed.storeId,
      tableId: seed.tableId,
      payableAmount: 150,
      items: [
        {
          menuProductId: seed.products.alpha.menuProductId,
          name: '招牌小炒',
          quantity: 3,
          payableLineAmount: 100,
        },
        {
          menuProductId: seed.products.beta.menuProductId,
          name: '凉拌黄瓜',
          quantity: 2,
          payableLineAmount: 50,
        },
      ],
    });
    const { merchantPaymentNo } = await seedPaymentAttempt({
      orderId,
      storeId: seed.storeId,
      amount: 150,
    });

    await paymentService.confirmOrderPaidByCallback(merchantPaymentNo, {
      amountFen: 150,
      transactionId: `txn-cent-${Date.now()}-${nextSeq()}`,
      paidAtMs: Date.now(),
      callbackReceivedAtMs: Date.now(),
    });

    const saleOrder = await prisma.saleOrder.findUniqueOrThrow({
      where: { scanOrderId: orderId },
      include: { items: true },
    });
    const unitSalePrices = saleOrder.items
      .flatMap((item) =>
        Array.from({ length: item.quantity }, () => item.salePrice),
      )
      .sort((a, b) => a - b);
    expect(unitSalePrices).toEqual([25, 25, 33, 33, 34]);
    expect(saleOrder.totalRevenue).toBe(150);
    const sumSalePrice = saleOrder.items.reduce(
      (sum, item) => sum + item.salePrice * item.quantity,
      0,
    );
    expect(sumSalePrice).toBe(saleOrder.totalRevenue);

    const cashFlow = await prisma.financeCashFlowRecord.findUniqueOrThrow({
      where: { saleOrderId: saleOrder.id },
    });
    expect(cashFlow.amount).toBe(150);
    // 逐分对账：财务流水 = 明细行合计
    expect(cashFlow.amount).toBe(sumSalePrice);
  });

  it('退款闭环：退款单/财务流水各一条，库存恢复，二次调用幂等', async () => {
    const seed = await seedStoreAndMenu();
    activeStoreId = seed.storeId;
    const { orderId, version } = await seedScanOrder({
      storeId: seed.storeId,
      tableId: seed.tableId,
      payableAmount: 2500,
      items: [
        {
          menuProductId: seed.products.alpha.menuProductId,
          name: '招牌小炒',
          quantity: 1,
          payableLineAmount: 2500,
        },
      ],
    });
    const { merchantPaymentNo } = await seedPaymentAttempt({
      orderId,
      storeId: seed.storeId,
      amount: 2500,
    });
    await paymentService.confirmOrderPaidByCallback(merchantPaymentNo, {
      amountFen: 2500,
      transactionId: `txn-refund-${Date.now()}-${nextSeq()}`,
      paidAtMs: Date.now(),
      callbackReceivedAtMs: Date.now(),
    });

    // 模拟下单时的库存预留（与 club-scan-ordering-order.service 语义一致）
    const alphaMenu = await prisma.scanOrderingMenuProduct.findUniqueOrThrow({
      where: { id: seed.products.alpha.menuProductId },
    });
    await prisma.scanOrderingMenuProduct.update({
      where: { id: seed.products.alpha.menuProductId },
      data: {
        stockQuantity: alphaMenu.stockQuantity - 1,
        salesCount: alphaMenu.salesCount + 1,
        version: { increment: 1 },
      },
    });
    await prisma.product.update({
      where: { id: seed.products.alpha.productId },
      data: { stock: { decrement: 1 } },
    });

    // 进入退款流程
    const paidOrder = await prisma.scanOrders.findUniqueOrThrow({
      where: { id: orderId },
    });
    await prisma.scanOrders.update({
      where: { id: orderId },
      data: { status: 'refunding', paymentStatus: 'refunding' },
    });

    await refundHandlingService.completeRefund(
      merchantUser,
      orderId,
      paidOrder.version,
      {
        refundNo: `refund-no-${nextSeq()}`,
        refundId: `refund-id-${nextSeq()}`,
      },
    );

    const refundedOrder = await prisma.scanOrders.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(refundedOrder.status).toBe('rejected');
    expect(refundedOrder.paymentStatus).toBe('refunded');
    expect(refundedOrder.fulfillmentStatus).toBe('closed');

    const saleOrder = await prisma.saleOrder.findUniqueOrThrow({
      where: { scanOrderId: orderId },
    });
    const refund = await prisma.saleOrderRefund.findUniqueOrThrow({
      where: { saleOrderId: saleOrder.id },
    });
    expect(refund.amount).toBe(2500);
    expect(refund.profit).toBe(500);
    expect(refund.paymentMethod).toBe('wechat');

    const expenseFlow = await prisma.financeCashFlowRecord.findUniqueOrThrow({
      where: { saleOrderRefundId: refund.id },
    });
    expect(expenseFlow.direction).toBe('expense');
    expect(expenseFlow.category).toBe('refund');
    expect(expenseFlow.amount).toBe(2500);

    // 库存恢复：菜单库存 9→10，销量 1→0，商品库存 9→10
    const restoredMenu = await prisma.scanOrderingMenuProduct.findUniqueOrThrow(
      { where: { id: seed.products.alpha.menuProductId } },
    );
    expect(restoredMenu.stockQuantity).toBe(10);
    expect(restoredMenu.salesCount).toBe(0);
    const restoredProduct = await prisma.product.findUniqueOrThrow({
      where: { id: seed.products.alpha.productId },
    });
    expect(restoredProduct.stock).toBe(10);

    // 二次退款：订单状态已是 rejected/refunded，抛 ConflictException，数据不重复
    await expect(
      refundHandlingService.completeRefund(
        merchantUser,
        orderId,
        refundedOrder.version,
      ),
    ).rejects.toThrow('订单退款已完成，请勿重复操作');
    expect(
      await prisma.saleOrderRefund.count({
        where: { saleOrderId: saleOrder.id },
      }),
    ).toBe(1);
    expect(
      await prisma.financeCashFlowRecord.count({
        where: { saleOrderRefundId: refund.id },
      }),
    ).toBe(1);
  });

  it('无销售单的退款：跳过销售单退款，不创建退款记录', async () => {
    const seed = await seedStoreAndMenu();
    activeStoreId = seed.storeId;
    // 订单已支付但桥接未执行（直接置为 paid），退款时无对应 saleOrder
    const { orderId, version } = await seedScanOrder({
      storeId: seed.storeId,
      tableId: seed.tableId,
      payableAmount: 1200,
      items: [
        {
          menuProductId: seed.products.beta.menuProductId,
          name: '凉拌黄瓜',
          quantity: 1,
          payableLineAmount: 1200,
        },
      ],
    });
    await prisma.scanOrders.update({
      where: { id: orderId },
      data: { status: 'refunding', paymentStatus: 'refunding' },
    });

    await refundHandlingService.completeRefund(merchantUser, orderId, version);

    const order = await prisma.scanOrders.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order.status).toBe('rejected');
    expect(order.paymentStatus).toBe('refunded');
    expect(
      await prisma.saleOrder.count({ where: { scanOrderId: orderId } }),
    ).toBe(0);
    expect(
      await prisma.financeCashFlowRecord.count({
        where: {
          saleOrderRefundId: { not: null },
          storeId: seed.storeId,
        },
      }),
    ).toBe(0);
  });
});
