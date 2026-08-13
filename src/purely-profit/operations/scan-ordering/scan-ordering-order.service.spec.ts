import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingPricingService } from './scan-ordering-pricing.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';
import { ScanOrderingOrderStateMachineService } from './scan-ordering-order-machine.service';
import { ScanOrderingPickupNumberService } from '../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
import { ScanOrderingOrderService } from './scan-ordering-order.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('ScanOrderingOrderService', () => {
  let service: ScanOrderingOrderService;

  const mockUser: AuthenticatedUser = {
    id: 1,
    role: 'store_owner',
  } as unknown as AuthenticatedUser;

  const prismaService = {
    scanOrders: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    scanOrderStatusHistory: {
      create: jest.fn(),
    },
    scanOrderItem: {
      findMany: jest.fn(),
    },
    scanOrderPaymentAttempt: {
      updateMany: jest.fn(),
    },
    scanOrderCouponUsage: {
      updateMany: jest.fn(),
    },
    scanOrderingMenuProduct: {
      updateMany: jest.fn(),
    },
    scanOrderingSpecOption: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };

  const pricingService = {
    calculateSummary: jest.fn(),
  };

  const realtimeService = {
    publishOrderStatusChanged: jest.fn(),
  };

  const refundService = {
    createRefundTask: jest.fn(),
    markRefundTaskSucceededInTransaction: jest.fn(),
  };

  const stateMachineService = {
    acceptOrder: jest.fn(),
    serveOrder: jest.fn(),
    rejectOrder: jest.fn(),
    cancelOrder: jest.fn(),
    completeOrder: jest.fn(),
    completeRefund: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingOrderService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: ScanOrderingPricingService, useValue: pricingService },
        { provide: ScanOrderingRealtimeService, useValue: realtimeService },
        { provide: ScanOrderingRefundService, useValue: refundService },
        {
          provide: ScanOrderingOrderStateMachineService,
          useValue: stateMachineService,
        },
        {
          provide: ScanOrderingPickupNumberService,
          useValue: {
            formatPickupNumber: (n: number | null | undefined) =>
              n == null
                ? null
                : n < 1000
                  ? String(n).padStart(3, '0')
                  : String(n),
            assignForPaidOrder: jest.fn(),
            getShanghaiBusinessDate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ScanOrderingOrderService>(ScanOrderingOrderService);

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(11);
    pricingService.calculateSummary.mockReturnValue({
      itemOriginalAmount: 28.5,
      specificationExtraAmount: 0,
      productDiscountAmount: 0,
      orderDiscountAmount: 0,
      taxAmount: 0,
      serviceFeeAmount: 0,
      payableAmount: 28.5,
      paidAmount: 28.5,
      outstandingAmount: 0,
      currency: 'CNY',
    });
  });

  // ── listOrders ───────────────────────────────────────────

  describe('listOrders', () => {
    it('使用 scan-ordering:view 权限解析门店', async () => {
      prismaService.scanOrders.findMany.mockResolvedValue([]);
      await service.listOrders(mockUser, {} as never);
      expect(commerceAccessService.resolveSingleStoreId).toHaveBeenCalledWith(
        mockUser,
        undefined,
        'scan-ordering:view',
        '无权查看扫码点餐订单',
      );
    });

    it('正确映射 itemSummary / items / version 和 tableName', async () => {
      const createdAt = new Date('2026-07-23T12:00:00.000Z');
      prismaService.scanOrders.findMany.mockResolvedValue([
        {
          id: 123,
          orderNo: 'SO20260723120000ABCD',
          status: 'preparing',
          createdAt,
          version: 7,
          table: { name: 'A01' },
          items: [
            {
              productNameSnapshot: '牛肉面',
              productImageUrlSnapshot: 'https://cdn.example.com/noodle.jpg',
              quantity: 2,
              unitPriceAmount: 1850,
              lineTotalAmount: 3700,
              payableLineAmount: 3700,
              specs: [
                { specOptionNameSnapshot: '加辣' },
                { specOptionNameSnapshot: '加蛋' },
              ],
            },
            {
              productNameSnapshot: '可乐',
              productImageUrlSnapshot: null,
              quantity: 1,
              unitPriceAmount: 300,
              lineTotalAmount: 300,
              payableLineAmount: 300,
              specs: [],
            },
          ],
          itemOriginalAmount: 4000,
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          taxAmount: 0,
          serviceFeeAmount: 0,
          paidAmount: 4000,
        },
      ]);

      const result = await service.listOrders(mockUser, {} as never);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(123);
      expect(result.items[0].orderNo).toBe('SO20260723120000ABCD');
      expect(result.items[0].version).toBe(7);
      // itemSummary 不再嵌入括号规格,仅展示商品+数量,完整明细走 items 数组
      expect(result.items[0].itemSummary).toBe('牛肉面×2、可乐×1');
      expect(result.items[0].tableName).toBe('A01');
      expect(result.items[0].createdAt).toBe(createdAt.toISOString());
      // items 数组提供完整明细(图片/规格/单价/金额)
      const [firstItem, secondItem] = result.items[0].items;
      expect(firstItem.productName).toBe('牛肉面');
      expect(firstItem.productImageUrl).toBe(
        'https://cdn.example.com/noodle.jpg',
      );
      expect(firstItem.quantity).toBe(2);
      expect(firstItem.specs).toEqual(['加辣', '加蛋']);
      expect(firstItem.unitPrice).toBe(18.5);
      expect(firstItem.lineTotalAmount).toBe(37);
      expect(firstItem.payableLineAmount).toBe(37);
      expect(secondItem.productName).toBe('可乐');
      expect(secondItem.productImageUrl).toBeNull();
      expect(secondItem.specs).toEqual([]);
      expect(secondItem.unitPrice).toBe(3);
      expect(secondItem.lineTotalAmount).toBe(3);
    });

    it('商品为空时 itemSummary 为空字符串', async () => {
      prismaService.scanOrders.findMany.mockResolvedValue([
        {
          id: 456,
          orderNo: 'SO456',
          status: 'pending_acceptance',
          createdAt: new Date(),
          version: 1,
          table: { name: 'B02' },
          items: [],
          itemOriginalAmount: 0,
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          taxAmount: 0,
          serviceFeeAmount: 0,
          paidAmount: 0,
        },
      ]);

      const result = await service.listOrders(mockUser, {} as never);
      expect(result.items[0].itemSummary).toBe('');
    });

    it('Prisma 查询包含 version 和 items 按 id asc 排序', async () => {
      prismaService.scanOrders.findMany.mockResolvedValue([]);
      await service.listOrders(mockUser, {} as never);

      const callArgs = prismaService.scanOrders.findMany.mock.calls[0][0];
      expect(callArgs.select.version).toBe(true);
      expect(callArgs.select.items).toEqual({
        select: {
          productNameSnapshot: true,
          productImageUrlSnapshot: true,
          quantity: true,
          unitPriceAmount: true,
          lineTotalAmount: true,
          payableLineAmount: true,
          specs: {
            select: { specOptionNameSnapshot: true },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { id: 'asc' },
      });
    });

    it('分页 nextCursor 正确返回', async () => {
      // 模拟返回 3 条（limit+1=3, limit=2），有下一页
      const orders = [3, 2, 1].map((id) => ({
        id,
        orderNo: `SO${id}`,
        status: 'preparing',
        createdAt: new Date(),
        version: 1,
        table: { name: 'T1' },
        items: [],
        itemOriginalAmount: 0,
        specificationExtraAmount: 0,
        productDiscountAmount: 0,
        orderDiscountAmount: 0,
        taxAmount: 0,
        serviceFeeAmount: 0,
        paidAmount: 0,
      }));
      prismaService.scanOrders.findMany.mockResolvedValue(orders);

      const result = await service.listOrders(mockUser, { limit: 2 } as never);

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe(2); // 最后一条的 id
    });

    it('无下一页时 nextCursor 为 null', async () => {
      prismaService.scanOrders.findMany.mockResolvedValue([
        {
          id: 1,
          orderNo: 'SO1',
          status: 'preparing',
          createdAt: new Date(),
          version: 1,
          table: { name: 'T1' },
          items: [],
          itemOriginalAmount: 0,
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          taxAmount: 0,
          serviceFeeAmount: 0,
          paidAmount: 0,
        },
      ]);

      const result = await service.listOrders(mockUser, { limit: 20 } as never);
      expect(result.nextCursor).toBeNull();
    });

    it('sessionOrderSequence 按 diningRoundId + clubUserId 累计，跨 diningRound 重新计数', async () => {
      // 同一桌 + 同一用户 + 同一 diningRound = 累计加餐序号
      // 清桌后新 diningRound = 序号重置为 1
      const sameRound = '11111111-1111-1111-1111-111111111111';
      const clearedRound = '22222222-2222-2222-2222-222222222222';
      const orders = [
        {
          id: 11,
          orderNo: 'SO11',
          status: 'preparing',
          createdAt: new Date('2026-07-23T12:01:00.000Z'),
          version: 1,
          clubUserId: 88,
          diningRoundId: sameRound,
          table: { name: 'A01' },
          items: [],
          itemOriginalAmount: 0,
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          taxAmount: 0,
          serviceFeeAmount: 0,
          paidAmount: 0,
        },
        {
          id: 12,
          orderNo: 'SO12',
          status: 'preparing',
          createdAt: new Date('2026-07-23T12:05:00.000Z'),
          version: 1,
          clubUserId: 88,
          diningRoundId: sameRound,
          table: { name: 'A01' },
          items: [],
          itemOriginalAmount: 0,
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          taxAmount: 0,
          serviceFeeAmount: 0,
          paidAmount: 0,
        },
        {
          id: 13,
          orderNo: 'SO13',
          status: 'preparing',
          createdAt: new Date('2026-07-23T12:10:00.000Z'),
          version: 1,
          clubUserId: 88,
          diningRoundId: clearedRound,
          table: { name: 'A01' },
          items: [],
          itemOriginalAmount: 0,
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          taxAmount: 0,
          serviceFeeAmount: 0,
          paidAmount: 0,
        },
      ];
      // 第一次 findMany = 列表查询；第二次 findMany = 查同 diningRound 历史
      prismaService.scanOrders.findMany
        .mockResolvedValueOnce(orders)
        .mockResolvedValueOnce(orders);

      const result = await service.listOrders(mockUser, { limit: 20 } as never);

      const byId = new Map(result.items.map((item) => [item.id, item]));
      // 同一 diningRound 内累加：第一笔=1（首单），第二笔=2（加餐）
      expect(byId.get(11)?.sessionOrderSequence).toBe(1);
      expect(byId.get(12)?.sessionOrderSequence).toBe(2);
      // 清桌后新 diningRound：从 1 重新计数（首单）
      expect(byId.get(13)?.sessionOrderSequence).toBe(1);
    });
  });

  // ── acceptOrder ──────────────────────────────────────────

  describe('acceptOrder', () => {
    it('委托给状态机服务处理接单', async () => {
      stateMachineService.acceptOrder.mockResolvedValue(undefined);

      await service.acceptOrder(mockUser, 100, 1);

      expect(stateMachineService.acceptOrder).toHaveBeenCalledWith(
        mockUser,
        100,
        1,
      );
    });
  });

  // ── rejectOrder（已支付 → refunding） ────────────────────

  describe('rejectOrder', () => {
    it('委托给状态机服务处理拒单', async () => {
      stateMachineService.rejectOrder.mockResolvedValue(undefined);

      await service.rejectOrder(mockUser, 200, 3, '商家拒单');

      expect(stateMachineService.rejectOrder).toHaveBeenCalledWith(
        mockUser,
        200,
        3,
        '商家拒单',
      );
    });
  });

  // ── completeRefund ───────────────────────────────────────

  describe('completeRefund', () => {
    it('委托给状态机服务处理退款完成', async () => {
      stateMachineService.completeRefund.mockResolvedValue(undefined);

      await service.completeRefund(mockUser, 300, 5);

      expect(stateMachineService.completeRefund).toHaveBeenCalledWith(
        mockUser,
        300,
        5,
        undefined,
      );
    });

    it('状态机抛出异常时向上传播', async () => {
      stateMachineService.completeRefund.mockRejectedValue(
        new NotFoundException('订单不存在'),
      );

      await expect(
        service.completeRefund(mockUser, 999, 1),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
