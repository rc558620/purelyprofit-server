import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import { ClubScanOrderingCheckoutService } from './club-scan-ordering-checkout.service';
import { ClubScanOrderingOrderHistoryService } from './club-scan-ordering-order-history.service';
import { ClubScanOrderingOrderPreviewService } from './club-scan-ordering-order-preview.service';
import { ClubScanOrderingOrderQueryService } from './club-scan-ordering-order-query.service';
import { ClubScanOrderingOrderService } from './club-scan-ordering-order.service';
import { ClubScanOrderingInventoryReservationService } from './club-scan-ordering-inventory-reservation.service';
import { ScanOrderingPricingVersionService } from './scan-ordering-pricing-version.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { CreateClubScanOrderDto } from './dto/club-scan-ordering.dto';

/**
 * 下单（create）安全防护测试：
 * - Idempotency-Key 必填与幂等（重复提交返回首次快照，防重复支付）
 * - cartVersion / pricingVersion 一致性校验（防脏写、防价格被篡改）
 * - 库存不足时事务回滚、不落订单
 */
describe('ClubScanOrderingOrderService.create 安全防护', () => {
  const IDEMPOTENCY_KEY = 'idem-test-key-0001';

  let service: ClubScanOrderingOrderService;

  const prisma = {
    idempotencyRecord: { findUnique: jest.fn() },
    scanOrderingSession: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  } as unknown as Record<string, jest.Mock>;

  const pricingVersionService = { computePricingVersion: jest.fn() };
  const cartPricing = {
    priceCart: jest.fn(),
    cartVersion: jest.fn(),
    resolvePromotions: jest.fn(),
    calculateAmounts: jest.fn(),
    reserveFiniteSpecStock: jest.fn(),
    buildOrderItemCreateData: jest.fn(),
  };
  const realtime = { publishOrderCreated: jest.fn() };
  const inventoryReservationService = {
    reserveMenuProductStock: jest.fn(
      async (
        txArg: typeof tx,
        items: Array<{ productId: number; quantity: number }>,
        _storeId: number,
      ) => {
        const grouped = new Map<
          number,
          { productId: number; quantity: number }
        >();
        for (const item of items) {
          const existing = grouped.get(item.productId);
          if (existing) {
            existing.quantity += item.quantity;
          } else {
            grouped.set(item.productId, {
              productId: item.productId,
              quantity: item.quantity,
            });
          }
        }
        const currentProducts = await txArg.scanOrderingMenuProduct.findMany();
        const inventoryProducts = await txArg.product.findMany();
        const productMap = new Map(
          (
            currentProducts as Array<{
              id: number;
              stockMode: string;
              stockQuantity: number | null;
              reservedQuantity: number;
              version: number;
              productId: number | null;
            }>
          ).map((product) => [product.id, product]),
        );
        const inventoryMap = new Map(
          (inventoryProducts as Array<{ id: number; stock: number }>).map(
            (product) => [product.id, product.stock],
          ),
        );
        for (const item of grouped.values()) {
          const current = productMap.get(item.productId);
          if (!current) throw new ConflictException('商品库存不足');
          const baseStock = current.productId
            ? (inventoryMap.get(current.productId) ?? 0)
            : (current.stockQuantity ?? 0);
          const availableStock = baseStock - current.reservedQuantity;
          if (
            current.stockMode !== 'unlimited' &&
            availableStock < item.quantity
          ) {
            throw new ConflictException('商品库存不足');
          }
          const updated = await txArg.scanOrderingMenuProduct.updateMany({
            where: {
              id: item.productId,
              version: current.version,
            } as unknown as never,
            data: {
              reservedQuantity: { increment: item.quantity },
              version: { increment: 1 },
            } as unknown as never,
          });
          if (updated.count === 0) throw new ConflictException('商品库存不足');
        }
      },
    ),
  };

  const tx = {
    idempotencyRecord: { create: jest.fn(), update: jest.fn() },
    product: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    scanOrderingMenuProduct: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    scanOrderingSession: { update: jest.fn() },
    scanOrders: { create: jest.fn() },
    scanOrderStatusHistory: { create: jest.fn() },
    scanOrderingCartItem: { updateMany: jest.fn() },
  } as Record<string, Record<string, jest.Mock>>;

  const user = { id: 7 } as AuthenticatedUser;

  const session = {
    id: 10,
    storeId: 1,
    tableId: 1,
    clubUserId: 7,
    diningRoundId: 'dr-1',
    guestCount: 1,
    status: 'active',
    expiresAt: new Date(Date.now() + 3600_000),
    deletedAt: null,
  };

  const pricedItem = {
    cartItemId: 1,
    productId: 1,
    inventoryProductId: 1,
    productName: '蒜蓉粉丝蒸虾',
    productImageUrl: null,
    categoryName: '热菜',
    quantity: 1,
    specSignature: 'sig-1',
    basePrice: 4800,
    unitPriceAmount: 4800,
    lineTotalAmount: 4800,
    specs: [],
  };
  const duplicatePricedItem = {
    ...pricedItem,
    cartItemId: 2,
  };

  const dto = {
    sessionId: 10,
    cartVersion: 1,
    guestCount: 1,
    usePoints: false,
    pricingVersion: 'pv-1',
  } as CreateClubScanOrderDto;

  const promotionResult = {
    memberBenefits: [],
    availableCoupons: [],
    appliedPromotions: [],
    productDiscountAmount: 0,
    memberDiscountAmount: 0,
    orderDiscountAmount: 0,
    pointsDeductAmount: 0,
    pointsUsed: 0,
    afterPointsPayableAmount: 4800,
    redeemRatioPoints: 100,
    availablePoints: 0,
    breakdownItems: [],
  };

  const amounts = {
    itemOriginalAmount: 4800,
    specificationExtraAmount: 0,
    productDiscountAmount: 0,
    orderDiscountAmount: 0,
    serviceFeeAmount: 0,
    taxAmount: 0,
    payableAmount: 4800,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prisma.$transaction = jest.fn((fn: (client: unknown) => unknown) => fn(tx));
    prisma.scanOrderingSession.findFirst = jest.fn().mockResolvedValue(session);
    prisma.idempotencyRecord.findUnique = jest.fn().mockResolvedValue(null);

    cartPricing.priceCart.mockResolvedValue([pricedItem]);
    cartPricing.cartVersion.mockReturnValue(dto.cartVersion);
    pricingVersionService.computePricingVersion.mockResolvedValue(
      dto.pricingVersion,
    );
    cartPricing.resolvePromotions.mockResolvedValue(promotionResult);
    cartPricing.calculateAmounts.mockReturnValue(amounts);
    cartPricing.reserveFiniteSpecStock.mockResolvedValue(undefined);
    cartPricing.buildOrderItemCreateData.mockReturnValue([]);

    tx.idempotencyRecord.create.mockResolvedValue({});
    // 菜单商品库存充足：可用库存 10，已预留 0
    tx.scanOrderingMenuProduct.findMany.mockResolvedValue([
      {
        id: 1,
        stockMode: 'finite',
        stockQuantity: 10,
        reservedQuantity: 0,
        version: 1,
        productId: 1,
      },
    ]);
    tx.product.findMany.mockResolvedValue([{ id: 1, stock: 10 }]);
    tx.scanOrderingMenuProduct.update.mockResolvedValue({});
    tx.scanOrderingMenuProduct.updateMany.mockResolvedValue({ count: 1 });
    tx.scanOrderingSession.update.mockResolvedValue({});
    tx.scanOrders.create.mockResolvedValue({
      id: 100,
      orderNo: 'SO100',
      payableAmount: 4800,
      paymentExpiresAt: new Date(),
      version: 1,
    });
    tx.scanOrderStatusHistory.create.mockResolvedValue({});
    tx.scanOrderingCartItem.updateMany.mockResolvedValue({});
    tx.idempotencyRecord.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubScanOrderingOrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScanOrderingUnpaidOrderClosureService, useValue: {} },
        {
          provide: ScanOrderingPricingVersionService,
          useValue: pricingVersionService,
        },
        { provide: ScanOrderingRealtimeService, useValue: realtime },
        { provide: ClubScanOrderingCartPricingService, useValue: cartPricing },
        { provide: ClubScanOrderingCheckoutService, useValue: {} },
        {
          provide: ClubScanOrderingInventoryReservationService,
          useValue: inventoryReservationService,
        },
        { provide: ClubScanOrderingOrderHistoryService, useValue: {} },
        { provide: ClubScanOrderingOrderQueryService, useValue: {} },
        { provide: ClubScanOrderingOrderPreviewService, useValue: {} },
        {
          provide: ScanOrderingPickupNumberService,
          useValue: {
            formatPickupNumber: (n: number | null | undefined) =>
              n == null
                ? null
                : n < 1000
                  ? String(n).padStart(3, '0')
                  : String(n),
          },
        },
      ],
    }).compile();
    service = module.get(ClubScanOrderingOrderService);
  });

  // ─── Idempotency-Key ────────────────────────────────────────────────

  it('缺少或过短的 Idempotency-Key 时拒绝创建订单', async () => {
    await expect(service.create(user, '', dto)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.create(user, 'short', dto)).rejects.toThrow(
      ConflictException,
    );
    // 校验发生在会话查询之前，不触碰任何业务数据
    expect(prisma.scanOrderingSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('相同幂等键重复提交返回首次响应快照（防重复支付）', async () => {
    prisma.idempotencyRecord.findUnique = jest.fn().mockResolvedValue({
      status: 'succeeded',
      responseSnapshot: { id: 100, orderNo: 'SO100' },
    });

    const result = await service.create(user, IDEMPOTENCY_KEY, dto);

    expect(result).toEqual({ id: 100, orderNo: 'SO100' });
    // 命中幂等记录后不再查询会话、不再走事务
    expect(prisma.scanOrderingSession.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('并发下同一幂等键只创建一次订单', async () => {
    // 第一次：无既有记录 → 创建成功；第二次：命中已落库快照 → 直接返回
    prisma.idempotencyRecord.findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: 'succeeded',
        responseSnapshot: { id: 100, orderNo: 'SO100' },
      });

    const first = await service.create(user, IDEMPOTENCY_KEY, dto);
    const second = await service.create(user, IDEMPOTENCY_KEY, dto);

    expect(first.id).toBe(100);
    expect(second.id).toBe(100);
    expect(tx.scanOrders.create).toHaveBeenCalledTimes(1);
  });

  // ─── 一致性校验 ─────────────────────────────────────────────────────

  it('购物车版本不一致时拒绝下单', async () => {
    cartPricing.cartVersion.mockReturnValue(999);

    await expect(service.create(user, IDEMPOTENCY_KEY, dto)).rejects.toThrow(
      '购物车已更新',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('定价版本不一致时拒绝下单（价格被篡改防护）', async () => {
    pricingVersionService.computePricingVersion.mockResolvedValue('pv-2');

    await expect(service.create(user, IDEMPOTENCY_KEY, dto)).rejects.toThrow(
      '订单价格已变化',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ─── 库存与落库 ─────────────────────────────────────────────────────

  it('库存不足时抛错且不落订单', async () => {
    // 关联共用商品时以 product.stock 为准；菜单商品自身库存充足但共用库存不足
    tx.product.findMany.mockResolvedValue([{ id: 1, stock: 0 }]);

    await expect(service.create(user, IDEMPOTENCY_KEY, dto)).rejects.toThrow(
      '商品库存不足',
    );
    expect(tx.scanOrders.create).not.toHaveBeenCalled();
  });

  it('同一商品重复出现在同一订单时会先聚合后预留，不会误报库存不足', async () => {
    cartPricing.priceCart.mockResolvedValue([pricedItem, duplicatePricedItem]);
    cartPricing.cartVersion.mockReturnValue(2);
    cartPricing.calculateAmounts.mockReturnValue({
      ...amounts,
      itemOriginalAmount: 9600,
      payableAmount: 9600,
    });
    const duplicateDto = {
      ...dto,
      cartVersion: 2,
    } as CreateClubScanOrderDto;
    tx.scanOrderingMenuProduct.findMany.mockResolvedValue([
      {
        id: 1,
        stockMode: 'finite',
        stockQuantity: 10,
        reservedQuantity: 0,
        version: 1,
        productId: 1,
      },
    ]);
    tx.product.findMany.mockResolvedValue([{ id: 1, stock: 10 }]);

    const result = await service.create(user, IDEMPOTENCY_KEY, duplicateDto);

    expect(result.id).toBe(100);
    expect(tx.scanOrderingMenuProduct.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.scanOrderingMenuProduct.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 1, version: 1 }),
        data: expect.objectContaining({
          reservedQuantity: { increment: 2 },
          version: { increment: 1 },
        }),
      }),
    );
  });

  it('成功创建订单：预留库存、落库、幂等记录置为 succeeded、发布实时事件', async () => {
    const result = await service.create(user, IDEMPOTENCY_KEY, dto);

    expect(result.id).toBe(100);
    // 新逻辑：下单只预留库存（reservedQuantity+），不扣减 product.stock
    expect(tx.scanOrderingMenuProduct.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 1 }),
        data: expect.objectContaining({
          reservedQuantity: { increment: 1 },
          version: { increment: 1 },
        }),
      }),
    );
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.scanOrders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 10,
          guestCount: 1,
          pricingVersion: 'pv-1',
        }),
      }),
    );
    expect(tx.idempotencyRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'succeeded' }),
      }),
    );
    expect(realtime.publishOrderCreated).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 100 }),
    );
  });

  it('order.created payload 携带 storeId/orderId/sessionId/status/paymentStatus/fulfillmentStatus', async () => {
    await service.create(user, IDEMPOTENCY_KEY, dto);

    expect(realtime.publishOrderCreated).toHaveBeenCalledWith({
      storeId: 1,
      orderId: 100,
      sessionId: 10,
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'preparing',
    });
  });

  // ─── 事务提交后才发布 order.created（防 Profit 读到未提交订单）────

  describe('事务提交后才发布 order.created', () => {
    it('数据库事务提交之前不发布 order.created', async () => {
      let resolveTx!: (value: unknown) => void;
      prisma.$transaction = jest.fn(
        () =>
          new Promise((resolve) => {
            resolveTx = resolve;
          }),
      );

      const createPromise = service.create(user, IDEMPOTENCY_KEY, dto);
      // 事务仍在等待提交（等待 create 内部多个 await 走到 $transaction）
      await new Promise((resolve) => setImmediate(resolve));
      expect(realtime.publishOrderCreated).not.toHaveBeenCalled();

      // 事务提交完成
      resolveTx({
        id: 100,
        orderNo: 'SO100',
        payableAmount: 4800,
        paymentExpiresAt: new Date(),
        version: 1,
      });
      await createPromise;

      expect(realtime.publishOrderCreated).toHaveBeenCalledTimes(1);
    });

    it('publishOrderCreated 的调用顺序在事务提交之后', async () => {
      const callOrder: string[] = [];
      prisma.$transaction = jest.fn(
        async (callback: (client: unknown) => unknown) => {
          callOrder.push('transaction:start');
          const result = await callback(tx);
          callOrder.push('transaction:committed');
          return result;
        },
      );
      const originalImpl = realtime.publishOrderCreated.getMockImplementation();
      realtime.publishOrderCreated.mockImplementation(() => {
        callOrder.push('publishOrderCreated');
      });
      try {
        await service.create(user, IDEMPOTENCY_KEY, dto);
      } finally {
        realtime.publishOrderCreated.mockImplementation(originalImpl);
      }

      expect(callOrder).toContain('transaction:committed');
      expect(callOrder).toContain('publishOrderCreated');
      expect(callOrder.indexOf('transaction:committed')).toBeLessThan(
        callOrder.indexOf('publishOrderCreated'),
      );
    });

    it('事务失败时不发布 order.created', async () => {
      tx.product.findMany.mockResolvedValue([{ id: 1, stock: 0 }]);

      await expect(service.create(user, IDEMPOTENCY_KEY, dto)).rejects.toThrow(
        '商品库存不足',
      );
      expect(realtime.publishOrderCreated).not.toHaveBeenCalled();
    });
  });
});
