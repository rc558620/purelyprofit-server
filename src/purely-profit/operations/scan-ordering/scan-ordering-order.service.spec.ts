import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingPricingService } from './scan-ordering-pricing.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';
import { ScanOrderingOrderStateMachineService } from './scan-ordering-order-machine.service';
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

    it('正确映射 itemSummary、version 和 tableName', async () => {
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
            { productNameSnapshot: '牛肉面', quantity: 2 },
            { productNameSnapshot: '可乐', quantity: 1 },
          ],
          itemOriginalAmount: 2850,
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          taxAmount: 0,
          serviceFeeAmount: 0,
          paidAmount: 2850,
        },
      ]);

      const result = await service.listOrders(mockUser, {} as never);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(123);
      expect(result.items[0].orderNo).toBe('SO20260723120000ABCD');
      expect(result.items[0].version).toBe(7);
      expect(result.items[0].itemSummary).toBe('牛肉面×2、可乐×1');
      expect(result.items[0].tableName).toBe('A01');
      expect(result.items[0].createdAt).toBe(createdAt.toISOString());
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
        select: { productNameSnapshot: true, quantity: true },
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

      await service.completeRefund(mockUser, 300, 5, undefined, undefined);

      expect(stateMachineService.completeRefund).toHaveBeenCalledWith(
        mockUser,
        300,
        5,
        undefined,
        undefined,
      );
    });

    it('状态机抛出异常时向上传播', async () => {
      stateMachineService.completeRefund.mockRejectedValue(
        new NotFoundException('订单不存在'),
      );

      await expect(
        service.completeRefund(mockUser, 999, 1, undefined, undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
