import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import { ClubScanOrderingCheckoutService } from './club-scan-ordering-checkout.service';
import { ClubScanOrderingOrderHistoryService } from './club-scan-ordering-order-history.service';
import { ClubScanOrderingOrderPreviewService } from './club-scan-ordering-order-preview.service';
import { ClubScanOrderingOrderQueryService } from './club-scan-ordering-order-query.service';
import { ClubScanOrderingOrderService } from './club-scan-ordering-order.service';
import { ScanOrderingPricingVersionService } from './scan-ordering-pricing-version.service';
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

  const tx = {
    idempotencyRecord: { create: jest.fn(), update: jest.fn() },
    product: { updateMany: jest.fn() },
    scanOrderingMenuProduct: { update: jest.fn(), updateMany: jest.fn() },
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
    tx.product.updateMany.mockResolvedValue({ count: 1 });
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
        { provide: ClubScanOrderingOrderHistoryService, useValue: {} },
        { provide: ClubScanOrderingOrderQueryService, useValue: {} },
        { provide: ClubScanOrderingOrderPreviewService, useValue: {} },
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
    tx.product.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.create(user, IDEMPOTENCY_KEY, dto)).rejects.toThrow(
      '商品库存不足',
    );
    expect(tx.scanOrders.create).not.toHaveBeenCalled();
  });

  it('成功创建订单：扣库存、落库、幂等记录置为 succeeded、发布实时事件', async () => {
    const result = await service.create(user, IDEMPOTENCY_KEY, dto);

    expect(result.id).toBe(100);
    expect(tx.product.updateMany).toHaveBeenCalled();
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
});
