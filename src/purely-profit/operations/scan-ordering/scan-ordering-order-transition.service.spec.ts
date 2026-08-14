import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ScanOrderFulfillmentStatus,
  ScanOrderPickupNumberStatus,
  ScanOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingPickupNumberService } from '../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
import { ScanOrderingSaleOrderBridgeService } from '../../../purely-club/scan-ordering/scan-ordering-sale-order-bridge.service';
import { ScanOrderingOrderTransitionEngineService } from './scan-ordering-order-transition.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('ScanOrderingOrderTransitionEngineService 出餐事件 payload', () => {
  let service: ScanOrderingOrderTransitionEngineService;
  let publishOrderStatusChanged: jest.Mock;
  let updateMany: jest.Mock;
  let scanOrdersFindUnique: jest.Mock;

  const mockUser: AuthenticatedUser = {
    id: 1,
    role: 'store_owner',
  } as unknown as AuthenticatedUser;

  const prismaService = {
    // 事务：直接执行回调，复用同一组 scanOrders / scanOrderStatusHistory mock
    $transaction: jest.fn(),
    scanOrders: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    scanOrderStatusHistory: {
      create: jest.fn(),
    },
    store: {
      findUnique: jest.fn(),
    },
  };

  const saleOrderBridgeService = {
    createForPaidOrder: jest.fn(),
  };

  const txMock = {
    scanOrders: prismaService.scanOrders,
    scanOrderStatusHistory: prismaService.scanOrderStatusHistory,
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };

  const realtimeService = {
    publishOrderStatusChanged: jest.fn(),
  };

  const pickupNumberService = {
    formatPickupNumber: jest.fn((value: number | null) =>
      value == null ? null : String(value).padStart(3, '0'),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    publishOrderStatusChanged = realtimeService.publishOrderStatusChanged;
    updateMany = prismaService.scanOrders.updateMany;
    scanOrdersFindUnique = prismaService.scanOrders.findUnique;
    // 事务透传：回调内使用的 scanOrders / history 与事务外共用同一组 mock
    prismaService.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingOrderTransitionEngineService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: ScanOrderingRealtimeService, useValue: realtimeService },
        {
          provide: ScanOrderingPickupNumberService,
          useValue: pickupNumberService,
        },
        {
          provide: ScanOrderingSaleOrderBridgeService,
          useValue: saleOrderBridgeService,
        },
      ],
    }).compile();

    service = module.get(ScanOrderingOrderTransitionEngineService);
  });

  const mockOrderQuery = (overrides: Record<string, unknown> = {}): void => {
    // 第一次 findUnique：serveOrder 内查询取餐号与支付渠道
    // 第二次 findUnique：事务内查询更新后的完整订单（用于事件发布）
    scanOrdersFindUnique
      .mockResolvedValueOnce({
        pickupNumber: 1,
        paymentAttempts: [{ paymentChannel: 'wechat' }],
      })
      .mockResolvedValueOnce({
        id: 1001,
        storeId: 42,
        sessionId: 7,
        status: ScanOrderStatus.served,
        paymentStatus: 'paid',
        fulfillmentStatus: ScanOrderFulfillmentStatus.served,
        pickupNumber: 1,
        pickupBusinessDate: new Date('2026-08-05'),
        pickupNumberStatus: ScanOrderPickupNumberStatus.called,
        pickupCalledAt: new Date('2026-08-05T10:00:00.000Z'),
        pickupCompletedAt: null,
        ...overrides,
      });
  };

  it('语音开关开启：出餐事件 payload 包含 pickupNumber/pickupNumberLabel/pickupCalledAt/pickupVoiceEnabled=true', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(42);
    prismaService.store.findUnique.mockResolvedValue({
      pickupVoiceEnabled: true,
    });
    updateMany.mockResolvedValue({ count: 1 });
    prismaService.scanOrderStatusHistory.create.mockResolvedValue({ id: 1 });
    saleOrderBridgeService.createForPaidOrder.mockResolvedValue(undefined);
    mockOrderQuery();

    await service.serveOrder(mockUser, 1001, 3);

    expect(publishOrderStatusChanged).toHaveBeenCalledTimes(1);
    const payload = publishOrderStatusChanged.mock.calls[0][0];
    expect(payload.orderId).toBe(1001);
    expect(payload.storeId).toBe(42);
    expect(payload.status).toBe('served');
    expect(payload.fulfillmentStatus).toBe('served');
    expect(payload.pickupNumber).toBe(1);
    expect(payload.pickupNumberLabel).toBe('001');
    expect(payload.pickupNumberStatus).toBe('called');
    expect(payload.pickupCalledAt).toBe('2026-08-05T10:00:00.000Z');
    expect(payload.pickupVoiceEnabled).toBe(true);
  });

  it('语音开关关闭：事件 payload 中 pickupVoiceEnabled=false', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(42);
    prismaService.store.findUnique.mockResolvedValue({
      pickupVoiceEnabled: false,
    });
    updateMany.mockResolvedValue({ count: 1 });
    prismaService.scanOrderStatusHistory.create.mockResolvedValue({ id: 1 });
    saleOrderBridgeService.createForPaidOrder.mockResolvedValue(undefined);
    mockOrderQuery();

    await service.serveOrder(mockUser, 1001, 3);

    const payload = publishOrderStatusChanged.mock.calls[0][0];
    expect(payload.pickupVoiceEnabled).toBe(false);
  });

  it('重复出餐：不产生新的实时事件、不覆盖 pickupCalledAt', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(42);
    prismaService.store.findUnique.mockResolvedValue({
      pickupVoiceEnabled: true,
    });
    // 第一次出餐后重试：serveOrder 首次查询仍返回订单
    scanOrdersFindUnique.mockResolvedValueOnce({
      pickupNumber: 1,
      paymentAttempts: [{ paymentChannel: 'wechat' }],
    });
    // updateMany count=0（状态已非 preparing，version 不匹配）
    updateMany.mockResolvedValue({ count: 0 });
    // count=0 路径：findFirst 用于定位订单是否存在
    prismaService.scanOrders.findFirst.mockResolvedValue({ id: 1001 });

    await expect(service.serveOrder(mockUser, 1001, 3)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(publishOrderStatusChanged).not.toHaveBeenCalled();
    expect(prismaService.scanOrderStatusHistory.create).not.toHaveBeenCalled();
  });

  it('订单不存在：抛 NotFoundException', async () => {
    scanOrdersFindUnique.mockResolvedValueOnce(null);

    await expect(service.serveOrder(mockUser, 999, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(publishOrderStatusChanged).not.toHaveBeenCalled();
  });
});
