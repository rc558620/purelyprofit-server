import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import {
  createSpaceSessionRecord,
  createSpaceTestUser,
} from './space-session.spec-helpers';
import { SpaceSessionAutoCheckoutService } from './space-session-auto-checkout.service';
import { SpaceSessionSettlementService } from './space-session-settlement.service';

describe('SpaceSessionAutoCheckoutService', () => {
  let service: SpaceSessionAutoCheckoutService;

  const prismaService = {
    spaceSession: {
      findMany: jest.fn(),
    },
  };
  const settlementService = {
    settleSession: jest.fn(),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const redisClient = {
    set: jest.fn(),
  };
  const redisService = {
    getClient: jest.fn(() => redisClient),
    del: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.spaceSession.findMany.mockResolvedValue([]);
    settlementService.settleSession.mockResolvedValue(undefined);
    redisClient.set.mockResolvedValue('OK');
    redisService.del.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionAutoCheckoutService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: SpaceSessionSettlementService,
          useValue: settlementService,
        },
      ],
    }).compile();

    service = module.get<SpaceSessionAutoCheckoutService>(
      SpaceSessionAutoCheckoutService,
    );
    Object.assign(service as object, { logger });
  });

  it('autoCheckoutExpiredCountdownSessions 会结账已到期的倒计时自动结账会话', async () => {
    const user = createSpaceTestUser();
    const session = createSpaceSessionRecord();
    const checkoutAt = new Date(2026, 5, 4, 10, 0, 0).getTime();

    prismaService.spaceSession.findMany.mockResolvedValueOnce([
      {
        ...session,
        billingMode: 'countdown',
        countdownMinutes: 60,
        autoCheckout: true,
        prepaidPaymentMethod: 'cash',
        items: [],
        renewRecords: [],
      },
    ]);

    const result = await service.autoCheckoutExpiredCountdownSessions(
      user,
      18,
      checkoutAt,
    );

    expect(redisClient.set).toHaveBeenCalledWith(
      'space:auto-checkout:store:18',
      expect.any(String),
      'EX',
      30,
      'NX',
    );
    expect(prismaService.spaceSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          status: 'active',
          billingMode: 'countdown',
          autoCheckout: true,
        }),
      }),
    );
    expect(settlementService.settleSession).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        paymentMethod: 'cash',
        checkoutAt,
        note: '倒计时到期自动结账',
      }),
    );
    expect(redisService.del).toHaveBeenCalledWith(
      'space:auto-checkout:store:18',
    );
    expect(result).toBe(1);
  });

  it('autoCheckoutExpiredCountdownSessions 在已有并发任务时应跳过本次执行', async () => {
    const user = createSpaceTestUser();

    redisClient.set.mockResolvedValueOnce(null);

    const result = await service.autoCheckoutExpiredCountdownSessions(user, 18);

    expect(prismaService.spaceSession.findMany).not.toHaveBeenCalled();
    expect(settlementService.settleSession).not.toHaveBeenCalled();
    expect(redisService.del).not.toHaveBeenCalled();
    expect(result).toBe(0);
  });

  it('autoCheckoutExpiredCountdownSessions 在查询待结账会话失败时不应打断读链路', async () => {
    const user = createSpaceTestUser();

    prismaService.spaceSession.findMany.mockRejectedValueOnce(
      new Error('read sessions timeout'),
    );

    const result = await service.autoCheckoutExpiredCountdownSessions(
      user,
      18,
      Date.now(),
      'spaces:dashboard',
      'req-query-fail',
    );

    expect(result).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        '[space-auto-checkout] aborted trigger=spaces:dashboard storeId=18 requestId=req-query-fail userId=1 reason=Error',
      ),
      expect.any(String),
    );
    expect(redisService.del).toHaveBeenCalledWith(
      'space:auto-checkout:store:18',
    );
  });

  it('autoCheckoutExpiredCountdownSessions 在单个会话结账失败时不应打断读链路', async () => {
    const user = createSpaceTestUser();
    const session = createSpaceSessionRecord();
    const checkoutAt = new Date(2026, 5, 4, 10, 0, 0).getTime();

    prismaService.spaceSession.findMany.mockResolvedValueOnce([
      {
        ...session,
        billingMode: 'countdown',
        countdownMinutes: 60,
        autoCheckout: true,
        prepaidPaymentMethod: 'cash',
        items: [],
        renewRecords: [],
      },
    ]);
    settlementService.settleSession.mockRejectedValueOnce(
      new Error('shift lookup timeout'),
    );

    const result = await service.autoCheckoutExpiredCountdownSessions(
      user,
      18,
      checkoutAt,
      'spaces:list',
      'req-1',
    );

    expect(result).toBe(0);
    expect(redisService.del).toHaveBeenCalledWith(
      'space:auto-checkout:store:18',
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        '[space-auto-checkout] failed trigger=spaces:list storeId=18 requestId=req-1 sessionId=9 reason=Error',
      ),
      expect.any(String),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        '[space-auto-checkout] completed trigger=spaces:list storeId=18 requestId=req-1 count=0 failedCount=1',
      ),
    );
  });

  it('autoCheckoutExpiredCountdownSessions 释放锁失败时不应打断读链路', async () => {
    const user = createSpaceTestUser();

    redisService.del.mockRejectedValueOnce(new Error('redis del timeout'));

    const result = await service.autoCheckoutExpiredCountdownSessions(
      user,
      18,
      Date.now(),
      'spaces:list',
      'req-release-fail',
    );

    expect(result).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[space-auto-checkout] release_lock_failed trigger=spaces:list storeId=18 requestId=req-release-fail userId=1 reason=Error',
      ),
    );
  });

  it('autoCheckoutExpiredCountdownSessions 遇到并发冲突时仍应按跳过处理', async () => {
    const user = createSpaceTestUser();
    const session = createSpaceSessionRecord();
    const checkoutAt = new Date(2026, 5, 4, 10, 0, 0).getTime();

    prismaService.spaceSession.findMany.mockResolvedValueOnce([
      {
        ...session,
        billingMode: 'countdown',
        countdownMinutes: 60,
        autoCheckout: true,
        prepaidPaymentMethod: 'cash',
        items: [],
        renewRecords: [],
      },
    ]);
    settlementService.settleSession.mockRejectedValueOnce(
      new ConflictException('当前会话已结账，无法重复操作'),
    );

    const result = await service.autoCheckoutExpiredCountdownSessions(
      user,
      18,
      checkoutAt,
      'space-reservations:list-store',
      'req-2',
    );

    expect(result).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[space-auto-checkout] skipped_session trigger=space-reservations:list-store storeId=18 requestId=req-2 sessionId=9 reason=ConflictException',
      ),
    );
  });

  it('autoCheckoutAllExpiredSessions 会逐店扫描并累计结果', async () => {
    prismaService.spaceSession.findMany.mockResolvedValueOnce([
      { storeId: 18 },
      { storeId: 19 },
    ]);
    jest
      .spyOn(service, 'autoCheckoutExpiredCountdownSessions')
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const result = await service.autoCheckoutAllExpiredSessions(
      new Date(2026, 5, 4, 10, 0, 0).getTime(),
    );

    expect(result).toBe(3);
    expect(
      service.autoCheckoutExpiredCountdownSessions,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 0, email: 'system@auto-checkout' }),
      18,
      new Date(2026, 5, 4, 10, 0, 0).getTime(),
      'scheduler:auto-checkout',
    );
    expect(
      service.autoCheckoutExpiredCountdownSessions,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 0, email: 'system@auto-checkout' }),
      19,
      new Date(2026, 5, 4, 10, 0, 0).getTime(),
      'scheduler:auto-checkout',
    );
  });
});
