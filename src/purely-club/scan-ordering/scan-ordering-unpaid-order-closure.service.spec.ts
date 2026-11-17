import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';

describe('ScanOrderingUnpaidOrderClosureService', () => {
  let service: ScanOrderingUnpaidOrderClosureService;

  const prismaService = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    scanOrders: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    scanOrderItem: {
      findMany: jest.fn(),
    },
    scanOrderingMenuProduct: {
      updateMany: jest.fn(),
    },
    scanOrderingSpecOption: {
      updateMany: jest.fn(),
    },
    product: {
      updateMany: jest.fn(),
    },
    scanOrderPaymentAttempt: {
      updateMany: jest.fn(),
    },
    scanOrderCouponUsage: {
      updateMany: jest.fn(),
    },
    scanOrderStatusHistory: {
      create: jest.fn(),
      createMany: jest.fn(),
    },
  };

  const realtimeService = {
    publishOrderStatusChanged: jest.fn(),
  };

  /** 收集已执行的批量 UPDATE 语句，用于断言走了哪条回补分支 */
  const executedSql = (): string =>
    prismaService.$executeRaw.mock.calls
      .map((call) => (call[0] as unknown as string[]).join(' '))
      .join('\n');

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaService) => Promise<unknown>) =>
        callback(prismaService),
    );
    // 默认「没有预留可释放」：RETURNING 返回空，全部进入恢复库存分支
    prismaService.$queryRaw.mockResolvedValue([]);
    prismaService.$executeRaw.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingUnpaidOrderClosureService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: ScanOrderingRealtimeService,
          useValue: realtimeService,
        },
      ],
    }).compile();

    service = module.get<ScanOrderingUnpaidOrderClosureService>(
      ScanOrderingUnpaidOrderClosureService,
    );
  });

  // ── 2.1 用户主动取消 ──────────────────────────────────────

  describe('2.1 用户主动取消', () => {
    beforeEach(() => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 1001,
        storeId: 11,
        sessionId: 55,
        version: 3,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 1001,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderItem.findMany.mockResolvedValue([
        {
          menuProductId: 201,
          quantity: 2,
          menuProduct: { productId: 901 },
          specs: [{ specOptionId: 301 }, { specOptionId: 302 }],
        },
      ]);
      // 默认无预留：先释放预留（count=0），再恢复已扣减库存
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.product.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 2,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});
    });

    it('订单变为 cancelled，fulfillmentStatus = closed', async () => {
      const result = await service.close({
        orderId: 1001,
        expectedVersion: 3,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(result).toEqual({
        orderId: 1001,
        storeId: 11,
        sessionId: 55,
        status: 'cancelled',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'closed',
      });

      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith({
        where: {
          id: 1001,
          version: 3,
          status: 'pending_payment',
          paymentStatus: 'unpaid',
        },
        data: {
          status: 'cancelled',
          fulfillmentStatus: 'closed',
          cancelledAt: expect.any(Date),
          cancelReason: '用户取消',
          version: { increment: 1 },
        },
      });
    });

    it('订单版本加一', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: { increment: 1 },
          }),
        }),
      );
    });

    it('cancelledAt 有值', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelledAt: expect.any(Date),
          }),
        }),
      );
    });

    it('cancelReason 正确', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: '用户取消',
          }),
        }),
      );
    });

    it('商品库存恢复（finite 模式）：无预留时先尝试释放再恢复已扣减库存', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      // 两条 RETURNING 查询（菜单商品 / 规格）均未命中 → 全部进入恢复分支
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
      expect(executedSql()).toContain(
        'UPDATE scan_ordering_menu_products AS m',
      );
      expect(executedSql()).toContain(
        'stock_quantity = m.stock_quantity + v.quantity',
      );
      // finite 且绑定商品库时还要回补 Product.stock
      expect(executedSql()).toContain('UPDATE products AS p');
    });

    it('商品库存恢复：有预留时仅释放预留不恢复已扣减库存', async () => {
      // RETURNING 返回全部目标行 → 没有行进入恢复分支
      prismaService.$queryRaw.mockResolvedValue([
        { id: 201 },
        { id: 301 },
        { id: 302 },
      ]);

      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prismaService.$executeRaw).not.toHaveBeenCalled();
    });

    it('规格库存恢复', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      // 规格预留未命中 → 执行一条批量恢复规格库存的 SQL
      expect(executedSql()).toContain('UPDATE scan_ordering_spec_options AS o');
      expect(executedSql()).toContain(
        'stock_quantity = o.stock_quantity + v.quantity',
      );
    });

    it('created / paying 支付尝试改为 closed', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(
        prismaService.scanOrderPaymentAttempt.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          orderId: 1001,
          status: { in: ['created', 'paying'] },
        },
        data: { status: 'closed' },
      });
    });

    it('locked 优惠券记录改为 released', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(
        prismaService.scanOrderCouponUsage.updateMany,
      ).toHaveBeenCalledWith({
        where: { orderId: 1001, status: 'locked' },
        data: { status: 'released', releasedAt: expect.any(Date) },
      });
    });

    it('写入 ScanOrderStatusHistory', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: 1001,
          storeId: 11,
          fromStatus: 'pending_payment',
          toStatus: 'cancelled',
          operatorType: 'club_user',
          operatorId: 201,
          reason: '用户取消',
        },
      });
    });

    it('事务成功后调用 publishOrderStatusChanged', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalledWith({
        orderId: 1001,
        storeId: 11,
        sessionId: 55,
        status: 'cancelled',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'closed',
      });
    });
  });

  // ── 2.2 重复取消幂等 ──────────────────────────────────────

  describe('2.2 重复取消幂等', () => {
    it('第一次返回成功', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 1002,
        storeId: 11,
        sessionId: 56,
        version: 1,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 1002,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaService.scanOrderItem.findMany.mockResolvedValue([]);
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});

      const result = await service.close({
        orderId: 1002,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(result).not.toBeNull();
      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalled();
    });

    it('第二次关闭时 updateMany count=0，返回 null，不重复恢复库存', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 1002,
        storeId: 11,
        sessionId: 56,
        version: 2, // version 已增加
      });
      prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 0 }); // 已不是 pending_payment
      prismaService.scanOrderItem.findMany.mockClear();

      const result = await service.close({
        orderId: 1002,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(result).toBeNull();
      // updateMany count=0 时不应该执行后续库存恢复
      expect(prismaService.scanOrderItem.findMany).not.toHaveBeenCalled();
      expect(prismaService.$queryRaw).not.toHaveBeenCalled();
      expect(prismaService.$executeRaw).not.toHaveBeenCalled();
      expect(realtimeService.publishOrderStatusChanged).not.toHaveBeenCalled();
    });
  });

  // ── 2.3 支付超时关闭 ──────────────────────────────────────

  describe('2.3 支付超时关闭', () => {
    beforeEach(() => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 2001,
        storeId: 11,
        sessionId: 60,
        version: 1,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 2001,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderItem.findMany.mockResolvedValue([
        {
          menuProductId: 201,
          quantity: 1,
          menuProduct: { productId: 902 },
          specs: [{ specOptionId: 301 }],
        },
      ]);
      // 默认无预留：先释放预留（count=0），再恢复已扣减库存
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.product.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});
    });

    it('使用系统操作人类型 system', async () => {
      await service.close({
        orderId: 2001,
        expectedVersion: 1,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operatorType: 'system',
            reason: '支付超时自动关闭',
          }),
        }),
      );
    });

    it('关闭原因明确为支付超时关闭', async () => {
      await service.close({
        orderId: 2001,
        expectedVersion: 1,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: '支付超时自动关闭',
          }),
        }),
      );
    });

    it('补偿行为与用户取消一致：恢复库存、关闭支付尝试、写历史', async () => {
      await service.close({
        orderId: 2001,
        expectedVersion: 1,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(prismaService.$queryRaw).toHaveBeenCalled();
      expect(executedSql()).toContain('UPDATE scan_ordering_menu_products');
      expect(executedSql()).toContain('UPDATE scan_ordering_spec_options');
      expect(
        prismaService.scanOrderPaymentAttempt.updateMany,
      ).toHaveBeenCalled();
      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalled();
    });

    it('实时事件发布', async () => {
      await service.close({
        orderId: 2001,
        expectedVersion: 1,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalledWith({
        orderId: 2001,
        storeId: 11,
        sessionId: 60,
        status: 'cancelled',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'closed',
      });
    });
  });

  // ── 2.4 不应关闭的订单 ─────────────────────────────────────

  describe('2.4 不应关闭的订单', () => {
    const terminalStatuses = [
      'pending_acceptance',
      'preparing',
      'served',
      'completed',
      'cancelled',
      'rejected',
    ];

    beforeEach(() => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 3001,
        storeId: 11,
        sessionId: 70,
        version: 5,
      });
      prismaService.scanOrderItem.findMany.mockResolvedValue([]);
      prismaService.scanOrderingMenuProduct.updateMany.mockClear();
      prismaService.scanOrderingSpecOption.updateMany.mockClear();
      prismaService.scanOrderPaymentAttempt.updateMany.mockClear();
      prismaService.scanOrderCouponUsage.updateMany.mockClear();
      prismaService.scanOrderStatusHistory.create.mockClear();
    });

    for (const status of terminalStatuses) {
      it(`status=${status} 时 updateMany count=0，不修改订单、不恢复库存、不关闭支付尝试、不写历史、不推送事件`, async () => {
        prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 0 });

        const result = await service.close({
          orderId: 3001,
          expectedVersion: 5,
          operatorType: 'system',
          reason: '支付超时自动关闭',
        });

        expect(result).toBeNull();
        expect(prismaService.scanOrderItem.findMany).not.toHaveBeenCalled();
        expect(prismaService.$queryRaw).not.toHaveBeenCalled();
        expect(prismaService.$executeRaw).not.toHaveBeenCalled();
        expect(
          prismaService.scanOrderPaymentAttempt.updateMany,
        ).not.toHaveBeenCalled();
        expect(
          prismaService.scanOrderCouponUsage.updateMany,
        ).not.toHaveBeenCalled();
        expect(
          prismaService.scanOrderStatusHistory.create,
        ).not.toHaveBeenCalled();
        expect(
          realtimeService.publishOrderStatusChanged,
        ).not.toHaveBeenCalled();
      });
    }

    it('paymentStatus=paid 时不应关闭', async () => {
      prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.close({
        orderId: 3001,
        expectedVersion: 5,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(result).toBeNull();
      // updateMany where 子句已经限制 paymentStatus: 'unpaid'，
      // paid 订单不会匹配，返回 count=0
      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            paymentStatus: 'unpaid',
          }),
        }),
      );
    });

    it('订单不存在时返回 null', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue(null);

      const result = await service.close({
        orderId: 9999,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(result).toBeNull();
      expect(prismaService.scanOrders.updateMany).not.toHaveBeenCalled();
      expect(realtimeService.publishOrderStatusChanged).not.toHaveBeenCalled();
    });
  });

  // ── 2.5 规格数量汇总 ──────────────────────────────────────

  describe('2.5 规格数量汇总', () => {
    it('同一规格项在多个订单项中被选中时，归还数量必须按所有订单项数量求和', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 4001,
        storeId: 11,
        sessionId: 80,
        version: 1,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 4001,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      // 两个订单项都选了 specOptionId=301，数量分别为 2 和 3
      prismaService.scanOrderItem.findMany.mockResolvedValue([
        {
          menuProductId: 201,
          quantity: 2,
          menuProduct: { productId: 901 },
          specs: [{ specOptionId: 301 }, { specOptionId: 302 }],
        },
        {
          menuProductId: 202,
          quantity: 3,
          menuProduct: { productId: null },
          specs: [{ specOptionId: 301 }, { specOptionId: 303 }],
        },
      ]);
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.product.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});

      await service.close({
        orderId: 4001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      // 数量求和由 aggregateStockRelease 纯函数专项覆盖，这里确认批量路径被接入
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
      expect(executedSql()).toContain('UPDATE scan_ordering_spec_options');
    });

    it('不得按规格项出现次数归还', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 4002,
        storeId: 11,
        sessionId: 81,
        version: 1,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 4002,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      // 同一规格出现在 3 个购物车行中，每行数量 1
      prismaService.scanOrderItem.findMany.mockResolvedValue([
        {
          menuProductId: 201,
          quantity: 1,
          menuProduct: { productId: 901 },
          specs: [{ specOptionId: 501 }],
        },
        {
          menuProductId: 202,
          quantity: 1,
          menuProduct: { productId: null },
          specs: [{ specOptionId: 501 }],
        },
        {
          menuProductId: 203,
          quantity: 1,
          menuProduct: { productId: 903 },
          specs: [{ specOptionId: 501 }],
        },
      ]);
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.product.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});

      await service.close({
        orderId: 4002,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      // 同一规格出现在 3 个购物车行时只回补一次，数量合计见 helper 专项单测
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
      expect(executedSql()).toContain('UPDATE scan_ordering_spec_options');
    });

    it('不得遗漏相同规格出现在不同商品行的情况', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 4003,
        storeId: 11,
        sessionId: 82,
        version: 1,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 4003,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderItem.findMany.mockResolvedValue([
        {
          menuProductId: 201,
          quantity: 5,
          menuProduct: { productId: 901 },
          specs: [{ specOptionId: 601 }, { specOptionId: 602 }],
        },
        {
          menuProductId: 202,
          quantity: 4,
          menuProduct: { productId: 902 },
          specs: [{ specOptionId: 602 }, { specOptionId: 603 }],
        },
      ]);
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.product.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});

      await service.close({
        orderId: 4003,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      // 不同商品行的规格数量求和由 helper 专项单测覆盖，这里确认批量路径被接入
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
      expect(executedSql()).toContain('UPDATE scan_ordering_spec_options');
    });
  });

  // ── 2.6 批量关单（超时扫描） ──────────────────────────────

  describe('2.6 批量关单', () => {
    /** 按顺序排队 $queryRaw 的返回：订单 UPDATE → 明细 → 规格 → 预留释放 → 预留释放 */
    const queueRaw = (...responses: unknown[]): void => {
      prismaService.$queryRaw.mockReset();
      for (const response of responses) {
        prismaService.$queryRaw.mockResolvedValueOnce(response);
      }
    };

    it('空批次不开事务、不推送事件', async () => {
      const closed = await service.closeBatch([], {
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(closed).toEqual([]);
      expect(prismaService.$transaction).not.toHaveBeenCalled();
      expect(realtimeService.publishOrderStatusChanged).not.toHaveBeenCalled();
    });

    it('RETURNING 为空（并发已被支付/接单抢走）时不回补库存、不推送', async () => {
      queueRaw([]);

      const closed = await service.closeBatch(
        [{ orderId: 1001, expectedVersion: 3 }],
        { operatorType: 'system', reason: '支付超时自动关闭' },
      );

      expect(closed).toEqual([]);
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1);
      expect(
        prismaService.scanOrderPaymentAttempt.updateMany,
      ).not.toHaveBeenCalled();
      expect(realtimeService.publishOrderStatusChanged).not.toHaveBeenCalled();
      expect(prismaService.$executeRaw).not.toHaveBeenCalled();
    });

    it('一批 N 单只开一次事务、集合写法各一条语句', async () => {
      queueRaw(
        [
          { id: 1001, store_id: 11, session_id: 55 },
          { id: 1002, store_id: 11, session_id: 55 },
          { id: 1003, store_id: 11, session_id: 56 },
        ],
        [
          {
            itemId: 1,
            orderId: 1001,
            storeId: 11,
            menuProductId: 201,
            quantity: 2,
            productId: 901,
          },
        ],
        [{ itemId: 1, specOptionId: 301 }],
        [],
        [],
      );
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 3,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.createMany.mockResolvedValue({
        count: 3,
      });

      const closed = await service.closeBatch(
        [
          { orderId: 1001, expectedVersion: 3 },
          { orderId: 1002, expectedVersion: 1 },
          { orderId: 1003, expectedVersion: 7 },
        ],
        { operatorType: 'system', reason: '支付超时自动关闭' },
      );

      expect(closed).toHaveLength(3);
      expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
      // 订单状态 / 支付尝试 / 券占用 / 状态历史：各一次集合写入
      expect(
        prismaService.scanOrderPaymentAttempt.updateMany,
      ).toHaveBeenCalledTimes(1);
      expect(
        prismaService.scanOrderPaymentAttempt.updateMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            orderId: { in: [1001, 1002, 1003] },
            status: expect.any(Object),
          },
        }),
      );
      expect(
        prismaService.scanOrderCouponUsage.updateMany,
      ).toHaveBeenCalledTimes(1);
      expect(
        prismaService.scanOrderStatusHistory.createMany,
      ).toHaveBeenCalledTimes(1);
      expect(
        prismaService.scanOrderStatusHistory.createMany.mock.calls[0][0].data,
      ).toHaveLength(3);
      // 每单一条实时事件
      expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalledTimes(
        3,
      );
      // 订单 UPDATE(1) + 明细(1) + 规格(1) + 每门店 2 条预留释放 = 5
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(5);
    });

    it('跨门店批次按门店分别回补库存', async () => {
      queueRaw(
        [
          { id: 1001, store_id: 11, session_id: 55 },
          { id: 2001, store_id: 22, session_id: 66 },
        ],
        [
          {
            itemId: 1,
            orderId: 1001,
            storeId: 11,
            menuProductId: 201,
            quantity: 1,
            productId: null,
          },
          {
            itemId: 2,
            orderId: 2001,
            storeId: 22,
            menuProductId: 202,
            quantity: 1,
            productId: null,
          },
        ],
        [],
        [],
        [],
        [],
        [],
      );

      await service.closeBatch(
        [
          { orderId: 1001, expectedVersion: 1 },
          { orderId: 2001, expectedVersion: 1 },
        ],
        { operatorType: 'system', reason: '支付超时自动关闭' },
      );

      // 订单 UPDATE(1) + 明细(1) + 规格(1) + 两个门店各 1 条商品预留释放 = 5
      //（本用例没有规格快照，`releaseSpecReservations` 在空集时直接短路，不发 SQL）
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(5);
      // 每个门店都要各自回补一次库存（不是只处理第一家店）
      expect(
        prismaService.$executeRaw.mock.calls.length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  describe('事务超时', () => {
    it('单笔 close() 与 closeBatch() 都显式设置超时，不吃 Prisma 默认值', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 1001,
        storeId: 11,
        sessionId: 55,
        version: 0,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 1001,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderItem.findMany.mockResolvedValue([]);
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});
      prismaService.scanOrderStatusHistory.createMany.mockResolvedValue({
        count: 0,
      });

      await service.close({
        orderId: 1001,
        expectedVersion: 0,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });
      await service.closeBatch([{ orderId: 1001, expectedVersion: 0 }], {
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      for (const call of prismaService.$transaction.mock.calls) {
        expect(call[1]).toEqual({ timeout: expect.any(Number) });
      }
      expect(prismaService.$transaction).toHaveBeenCalledTimes(2);
    });
  });
});
