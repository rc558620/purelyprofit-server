// 扫码点餐超时自动退款服务单元测试
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { ScanOrderingOrderRefundHandlingService } from './scan-ordering-order-refund.service';
import { ScanOrderingAcceptanceExpirationService } from './scan-ordering-acceptance-expiration.service';

describe('ScanOrderingAcceptanceExpirationService', () => {
  let service: ScanOrderingAcceptanceExpirationService;

  const prismaService = {
    scanOrders: {
      findMany: jest.fn(),
    },
  };

  const redisClient = {
    set: jest.fn(),
    eval: jest.fn(),
  };

  const redisService = {
    getClient: jest.fn(() => redisClient),
  };

  const refundHandlingService = {
    autoRefundByTimeout: jest.fn(),
    autoCloseManualEntryByTimeout: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockReturnValue(undefined);
    redisClient.set.mockResolvedValue('OK');
    prismaService.scanOrders.findMany.mockResolvedValue([]);
    refundHandlingService.autoRefundByTimeout.mockResolvedValue(undefined);
    refundHandlingService.autoCloseManualEntryByTimeout.mockResolvedValue(
      undefined,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingAcceptanceExpirationService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: ScanOrderingOrderRefundHandlingService,
          useValue: refundHandlingService,
        },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ScanOrderingAcceptanceExpirationService>(
      ScanOrderingAcceptanceExpirationService,
    );
  });

  it('无到期订单时不对退款服务发起任何调用', async () => {
    await service.expireDueOrders();

    expect(prismaService.scanOrders.findMany).toHaveBeenCalledTimes(2);
    expect(refundHandlingService.autoRefundByTimeout).not.toHaveBeenCalled();
  });

  it('待接单超时：按 paidAt 基准查询待接单订单并系统自动退款', async () => {
    prismaService.scanOrders.findMany.mockResolvedValueOnce([
      { id: 1001, storeId: 11, version: 3, manualEntry: false },
    ]);
    prismaService.scanOrders.findMany.mockResolvedValueOnce([]);

    await service.expireDueOrders();

    // 待接单候选查询：仅未接单、未删除、支付时间超阈值（扫码单与手工单都纳入）
    expect(prismaService.scanOrders.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'pending_acceptance',
        deletedAt: null,
        paidAt: { lte: expect.any(Date) },
      },
      orderBy: { paidAt: 'asc' },
      take: 100,
      select: { id: true, storeId: true, version: true, manualEntry: true },
    });
    expect(refundHandlingService.autoRefundByTimeout).toHaveBeenCalledWith({
      orderId: 1001,
      storeId: 11,
      version: 3,
      fromStatus: 'pending_acceptance',
      reason: '商家超时未接单，系统自动退款',
    });
  });

  it('制作中超时：按 acceptedAt 基准查询制作中订单并系统自动退款', async () => {
    prismaService.scanOrders.findMany.mockResolvedValueOnce([]);
    prismaService.scanOrders.findMany.mockResolvedValueOnce([
      { id: 2002, storeId: 22, version: 5, manualEntry: false },
    ]);

    await service.expireDueOrders();

    expect(prismaService.scanOrders.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: 'preparing',
        deletedAt: null,
        acceptedAt: { lte: expect.any(Date) },
      },
      orderBy: { acceptedAt: 'asc' },
      take: 100,
      select: { id: true, storeId: true, version: true, manualEntry: true },
    });
    expect(refundHandlingService.autoRefundByTimeout).toHaveBeenCalledWith({
      orderId: 2002,
      storeId: 22,
      version: 5,
      fromStatus: 'preparing',
      reason: '商家超时未出餐，系统自动退款',
    });
  });

  it('手工录入单超时：走自动关闭链路，不触发真实退款', async () => {
    prismaService.scanOrders.findMany.mockResolvedValueOnce([
      { id: 3003, storeId: 33, version: 2, manualEntry: true },
    ]);
    prismaService.scanOrders.findMany.mockResolvedValueOnce([]);

    await service.expireDueOrders();

    expect(refundHandlingService.autoRefundByTimeout).not.toHaveBeenCalled();
    expect(
      refundHandlingService.autoCloseManualEntryByTimeout,
    ).toHaveBeenCalledWith({
      orderId: 3003,
      storeId: 33,
      version: 2,
      fromStatus: 'pending_acceptance',
      reason: '商家超时未接单，系统自动退款',
    });
  });

  it('单笔退款失败不中断批次：继续处理剩余订单', async () => {
    prismaService.scanOrders.findMany.mockResolvedValueOnce([
      { id: 1001, storeId: 11, version: 3, manualEntry: false },
      { id: 1002, storeId: 11, version: 1, manualEntry: false },
    ]);
    prismaService.scanOrders.findMany.mockResolvedValueOnce([]);
    refundHandlingService.autoRefundByTimeout
      .mockRejectedValueOnce(new Error('订单状态已变化'))
      .mockResolvedValueOnce(undefined);

    await service.expireDueOrders();

    expect(refundHandlingService.autoRefundByTimeout).toHaveBeenCalledTimes(2);
    expect(refundHandlingService.autoRefundByTimeout).toHaveBeenLastCalledWith({
      orderId: 1002,
      storeId: 11,
      version: 1,
      fromStatus: 'pending_acceptance',
      reason: '商家超时未接单，系统自动退款',
    });
  });

  it('未获得分布式锁时不执行扫描', async () => {
    redisClient.set.mockResolvedValue(null);

    await service.expireDueOrders();

    expect(prismaService.scanOrders.findMany).not.toHaveBeenCalled();
    expect(refundHandlingService.autoRefundByTimeout).not.toHaveBeenCalled();
  });

  it('释放锁时使用 Lua 脚本校验 token 归属', async () => {
    await service.expireDueOrders();

    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get', KEYS[1])"),
      1,
      'scan-ordering:acceptance-expiration:lock',
      expect.any(String),
    );
  });
});
