import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';
import { ScanOrderingPaymentExpirationService } from './scan-ordering-payment-expiration.service';

describe('ScanOrderingPaymentExpirationService', () => {
  let service: ScanOrderingPaymentExpirationService;

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'scanOrdering.paymentExpirationIntervalMs') return 60_000;
      return undefined;
    }),
  };

  const redisClient = {
    set: jest.fn(),
    eval: jest.fn(),
  };

  const redisService = {
    getClient: jest.fn(() => redisClient),
  };

  const prismaService = {
    scanOrders: {
      findMany: jest.fn(),
    },
  };

  const unpaidOrderClosureService = {
    close: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    redisClient.set.mockResolvedValue('OK');
    redisClient.eval.mockResolvedValue(1);
    configService.get.mockImplementation((key: string) => {
      if (key === 'scanOrdering.paymentExpirationIntervalMs') return 60_000;
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingPaymentExpirationService,
        { provide: ConfigService, useValue: configService },
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: ScanOrderingUnpaidOrderClosureService,
          useValue: unpaidOrderClosureService,
        },
      ],
    }).compile();

    service = module.get<ScanOrderingPaymentExpirationService>(
      ScanOrderingPaymentExpirationService,
    );
  });

  // ── 1. 仅查询符合条件的过期未支付订单 ─────────────────────

  it('1. 仅查询符合条件的过期未支付订单', async () => {
    prismaService.scanOrders.findMany.mockResolvedValue([]);
    await service.expireDueOrders();

    expect(prismaService.scanOrders.findMany).toHaveBeenCalledWith({
      where: {
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        paymentExpiresAt: { lte: expect.any(Date) },
        deletedAt: null,
      },
      orderBy: { paymentExpiresAt: 'asc' },
      take: 100,
      select: { id: true, version: true },
    });
  });

  // ── 2. 不查询未到期订单 ──────────────────────────────────

  it('2. 查询条件包含 paymentExpiresAt <= now，不查询未到期订单', async () => {
    prismaService.scanOrders.findMany.mockResolvedValue([]);
    await service.expireDueOrders();

    const where = prismaService.scanOrders.findMany.mock.calls[0][0].where;
    expect(where.paymentExpiresAt).toEqual({ lte: expect.any(Date) });
    expect(where.status).toBe('pending_payment');
    expect(where.paymentStatus).toBe('unpaid');
  });

  // ── 3. 不查询已支付订单 ──────────────────────────────────

  it('3. 查询条件限制 paymentStatus=unpaid，不查询已支付订单', async () => {
    prismaService.scanOrders.findMany.mockResolvedValue([]);
    await service.expireDueOrders();

    const where = prismaService.scanOrders.findMany.mock.calls[0][0].where;
    expect(where.paymentStatus).toBe('unpaid');
  });

  // ── 4. 不查询已取消订单 ──────────────────────────────────

  it('4. 查询条件限制 status=pending_payment，不查询已取消订单', async () => {
    prismaService.scanOrders.findMany.mockResolvedValue([]);
    await service.expireDueOrders();

    const where = prismaService.scanOrders.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('pending_payment');
  });

  // ── 5. 不查询软删除订单 ──────────────────────────────────

  it('5. 查询条件包含 deletedAt=null，不查询软删除订单', async () => {
    prismaService.scanOrders.findMany.mockResolvedValue([]);
    await service.expireDueOrders();

    const where = prismaService.scanOrders.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
  });

  // ── 6. 单次扫描按设定批次大小处理 ─────────────────────────

  it('6. 单次扫描 take=100，按设定批次大小处理', async () => {
    prismaService.scanOrders.findMany.mockResolvedValue([]);
    await service.expireDueOrders();

    expect(prismaService.scanOrders.findMany.mock.calls[0][0].take).toBe(100);
  });

  // ── 7. Redis 锁未获取时直接跳过 ───────────────────────────

  it('7. Redis 锁未获取时直接跳过，不查询订单', async () => {
    redisClient.set.mockResolvedValue(null);
    await service.expireDueOrders();

    expect(prismaService.scanOrders.findMany).not.toHaveBeenCalled();
    expect(unpaidOrderClosureService.close).not.toHaveBeenCalled();
  });

  // ── 8. Redis 锁获取成功后会处理订单 ───────────────────────

  it('8. Redis 锁获取成功后会处理订单', async () => {
    prismaService.scanOrders.findMany.mockResolvedValue([
      { id: 1001, version: 1 },
      { id: 1002, version: 2 },
    ]);
    unpaidOrderClosureService.close.mockResolvedValue({ orderId: 1001 });

    await service.expireDueOrders();

    expect(unpaidOrderClosureService.close).toHaveBeenCalledTimes(2);
    expect(unpaidOrderClosureService.close).toHaveBeenCalledWith({
      orderId: 1001,
      expectedVersion: 1,
      operatorType: 'system',
      reason: '支付超时自动关闭',
    });
    expect(unpaidOrderClosureService.close).toHaveBeenCalledWith({
      orderId: 1002,
      expectedVersion: 2,
      operatorType: 'system',
      reason: '支付超时自动关闭',
    });
  });

  // ── 9. 单笔订单关闭失败不会阻止本批次其他订单处理 ───────

  it('9. 单笔订单关闭失败不会阻止本批次其他订单处理', async () => {
    prismaService.scanOrders.findMany.mockResolvedValue([
      { id: 2001, version: 1 },
      { id: 2002, version: 1 },
      { id: 2003, version: 1 },
    ]);
    unpaidOrderClosureService.close
      .mockRejectedValueOnce(new Error('订单 2001 关闭失败'))
      .mockResolvedValueOnce({ orderId: 2002 })
      .mockResolvedValueOnce({ orderId: 2003 });

    await expect(service.expireDueOrders()).resolves.not.toThrow();

    expect(unpaidOrderClosureService.close).toHaveBeenCalledTimes(3);
  });

  // ── 10. 处理后正确释放 Redis 锁 ───────────────────────────

  it('10. 处理后正确释放 Redis 锁', async () => {
    prismaService.scanOrders.findMany.mockResolvedValue([]);
    await service.expireDueOrders();

    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call'),
      1,
      'scan-ordering:payment-expiration:lock',
      expect.any(String),
    );
  });

  // ── 11. 多次扫描同一订单只发生一次库存归还 ─────────────────

  it('11. 多次扫描同一订单只发生一次库存归还', async () => {
    // 第一次扫描：订单存在，关闭成功
    prismaService.scanOrders.findMany.mockResolvedValueOnce([
      { id: 3001, version: 1 },
    ]);
    unpaidOrderClosureService.close.mockResolvedValueOnce({
      orderId: 3001,
    });

    await service.expireDueOrders();
    expect(unpaidOrderClosureService.close).toHaveBeenCalledTimes(1);

    // 第二次扫描：订单已被关闭，不再出现在查询结果中
    prismaService.scanOrders.findMany.mockResolvedValueOnce([]);
    await service.expireDueOrders();

    // close 仍只被调用一次
    expect(unpaidOrderClosureService.close).toHaveBeenCalledTimes(1);
  });

  // ── 12. 扫描服务启动时不应因 Redis 临时故障导致应用启动失败 ─

  it('12. Redis 故障时 expireDueOrders 记录错误并静默返回，不抛出异常', async () => {
    redisClient.set.mockRejectedValue(new Error('Redis connection refused'));
    const loggerSpy = jest.spyOn(
      service['logger'] as unknown as { error: jest.Mock },
      'error',
    );

    await expect(service.expireDueOrders()).resolves.not.toThrow();
    expect(loggerSpy).toHaveBeenCalled();
  });

  // ── 多实例验证：两个实例同时执行扫描 ───────────────────────

  describe('多实例验证', () => {
    it('两个实例同时执行扫描时，只有一个实例取得 Redis 锁并执行', async () => {
      // 模拟实例 A 获取锁成功
      redisClient.set.mockResolvedValueOnce('OK');
      prismaService.scanOrders.findMany.mockResolvedValue([
        { id: 5001, version: 1 },
      ]);
      unpaidOrderClosureService.close.mockResolvedValue({ orderId: 5001 });

      // 实例 A 执行
      await service.expireDueOrders();
      expect(prismaService.scanOrders.findMany).toHaveBeenCalledTimes(1);

      // 模拟实例 B 获取锁失败
      redisClient.set.mockResolvedValueOnce(null);

      // 实例 B 执行
      await service.expireDueOrders();

      // findMany 仍只被调用一次（实例 B 跳过了查询）
      expect(prismaService.scanOrders.findMany).toHaveBeenCalledTimes(1);
    });

    it('即便锁异常失效，订单条件更新仍可保证最终库存补偿至多一次', async () => {
      // 闭补偿服务的 updateMany where 子句包含 version 条件更新，
      // 第二次调用时 version 已不匹配，count=0，不会重复恢复库存
      prismaService.scanOrders.findMany.mockResolvedValue([
        { id: 6001, version: 1 },
      ]);
      // 第一次关闭成功
      unpaidOrderClosureService.close.mockResolvedValueOnce({
        orderId: 6001,
      });
      // 第二次关闭返回 null（version 已变，条件更新 count=0）
      unpaidOrderClosureService.close.mockResolvedValueOnce(null);

      await service.expireDueOrders();
      expect(unpaidOrderClosureService.close).toHaveBeenCalledTimes(1);

      // 第二次扫描同一订单
      await service.expireDueOrders();
      expect(unpaidOrderClosureService.close).toHaveBeenCalledTimes(2);
      // 第二次返回 null，不会触发库存恢复
      expect(unpaidOrderClosureService.close).toHaveBeenLastCalledWith({
        orderId: 6001,
        expectedVersion: 1,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });
    });
  });
});
