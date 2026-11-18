import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { RedisLockService } from '../../../redis/redis-lock.service';
import { aUuid } from '../../../spec-matchers';
import { createSpaceSessionRecord } from './space-session.spec-helpers';
import { SpaceSessionAutoCheckoutService } from './space-session-auto-checkout.service';
import { SpaceSessionSettlementService } from './space-session-settlement.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { createAutoCheckoutSystemUser } from './space-session-auto-checkout.shared';

/**
 * 自动结账锁治理：门店锁 TTL 覆盖串行上限 + 会话认领标记的获取与释放。
 * 与主 spec 分开，避免单个测试文件继续膨胀。
 */
describe('SpaceSessionAutoCheckoutService 会话认领锁', () => {
  let service: SpaceSessionAutoCheckoutService;

  const prismaService = {
    // 到期候选 ID 由 raw SQL 下推筛出
    $queryRaw: jest.fn(),
    spaceSession: { findMany: jest.fn() },
    clubVoucherOrder: { findMany: jest.fn() },
  };
  const settlementService = { settleSession: jest.fn() };
  const realtimeService = {
    publishSpaceSessionAutoCheckoutFailed: jest.fn(),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const redisClient = { set: jest.fn(), eval: jest.fn() };
  const redisService = {
    getClient: jest.fn(() => redisClient),
    setIfAbsent: jest.fn(),
  };

  const checkoutAt = new Date(2026, 5, 4, 10, 0, 0).getTime();

  const makeCountdownSession = (id: number) => ({
    ...createSpaceSessionRecord(),
    id,
    billingMode: 'countdown',
    countdownMinutes: 60,
    autoCheckout: true,
    prepaidPaymentMethod: 'cash',
    prepaidVoucherCode: null,
    sessionItems: [],
    sessionRenewRecords: [],
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // 默认存在 1 条到期会话，具体会话内容由各类例的 findMany mock 决定
    prismaService.$queryRaw.mockResolvedValue([{ id: 1 }]);
    prismaService.spaceSession.findMany.mockResolvedValue([]);
    prismaService.clubVoucherOrder.findMany.mockResolvedValue([]);
    settlementService.settleSession.mockResolvedValue(undefined);
    redisClient.set.mockResolvedValue('OK');
    redisClient.eval.mockResolvedValue(1);
    redisService.setIfAbsent.mockImplementation(
      async (key: string, value: string, ttlSeconds: number) => {
        const result = await redisClient.set(
          key,
          value,
          'EX',
          ttlSeconds,
          'NX',
        );
        return result === 'OK';
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionAutoCheckoutService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: SpaceSessionSettlementService,
          useValue: settlementService,
        },
        {
          provide: ScanOrderingRealtimeService,
          useValue: realtimeService,
        },
        RedisLockService,
      ],
    }).compile();

    service = module.get<SpaceSessionAutoCheckoutService>(
      SpaceSessionAutoCheckoutService,
    );
    Object.assign(service as object, { logger });
  });

  const runAutoCheckout = (requestId?: string): Promise<number> =>
    service.autoCheckoutExpiredCountdownSessions(
      createAutoCheckoutSystemUser(),
      18,
      checkoutAt,
      'scheduler:auto-checkout',
      requestId,
    );

  it('门店锁 TTL 覆盖多会话串行上限（120s，而非 30s）', async () => {
    await runAutoCheckout();

    expect(redisClient.set).toHaveBeenCalledWith(
      'distributed-lock:space:auto-checkout:store:18',
      aUuid,
      'EX',
      120,
      'NX',
    );
  });

  it('会话认领失败时跳过该会话且不调用 settleSession', async () => {
    prismaService.spaceSession.findMany.mockResolvedValueOnce([
      makeCountdownSession(9),
    ]);
    redisClient.set
      .mockResolvedValueOnce('OK') // 门店锁
      .mockResolvedValueOnce(null); // 会话认领被他人持有

    const result = await runAutoCheckout('req-claim-miss');

    expect(redisClient.set).toHaveBeenCalledWith(
      'distributed-lock:space:auto-checkout:claim:9',
      aUuid,
      'EX',
      120,
      'NX',
    );
    expect(settlementService.settleSession).not.toHaveBeenCalled();
    expect(result).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[space-auto-checkout] skipped_claimed trigger=scheduler:auto-checkout storeId=18 requestId=req-claim-miss sessionId=9 reason=SessionClaimed',
      ),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('skippedClaimedCount=1'),
    );
  });

  it('认领成功后结账并释放会话认领锁', async () => {
    prismaService.spaceSession.findMany.mockResolvedValueOnce([
      makeCountdownSession(9),
    ]);

    const result = await runAutoCheckout();

    expect(result).toBe(1);
    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', KEYS[1]) == ARGV[1]"),
      1,
      'distributed-lock:space:auto-checkout:claim:9',
      aUuid,
    );
    // 门店锁同样在 finally 释放，不能被认领释放替代
    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', KEYS[1]) == ARGV[1]"),
      1,
      'distributed-lock:space:auto-checkout:store:18',
      aUuid,
    );
  });

  it('结账抛异常时也必须释放会话认领锁', async () => {
    prismaService.spaceSession.findMany.mockResolvedValueOnce([
      makeCountdownSession(9),
    ]);
    settlementService.settleSession.mockRejectedValueOnce(
      new Error('settle boom'),
    );

    const result = await runAutoCheckout();

    expect(result).toBe(0);
    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', KEYS[1]) == ARGV[1]"),
      1,
      'distributed-lock:space:auto-checkout:claim:9',
      aUuid,
    );
  });
});
