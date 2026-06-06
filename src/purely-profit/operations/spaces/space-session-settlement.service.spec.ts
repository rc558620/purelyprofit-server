import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { SalesRecordService } from '../sales-record/sales-record.service';
import {
  createSalesOrderResponse,
  createSettleSpaceSessionParams,
  createSpaceSessionRecord,
  createSpaceTestUser,
  createSpaceTransactionClient,
  createUpdatedSpaceSession,
  expectedSalesRecordCreateOptions,
} from './space-session.spec-helpers';
import { SpaceSessionSettlementService } from './space-session-settlement.service';

describe('SpaceSessionSettlementService', () => {
  let service: SpaceSessionSettlementService;

  const transactionClient = createSpaceTransactionClient();
  const prismaService = {
    spaceSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const salesRecordService = {
    create: jest.fn(),
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
    prismaService.spaceSession.findUnique.mockResolvedValue({
      status: 'active',
    });
    prismaService.spaceSession.findMany.mockResolvedValue([]);
    redisClient.set.mockResolvedValue('OK');
    redisService.del.mockResolvedValue(undefined);
    prismaService.$transaction.mockImplementation(
      async (
        callback: (client: typeof transactionClient) => Promise<unknown>,
      ) => callback(transactionClient),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionSettlementService,
        { provide: PrismaService, useValue: prismaService },
        { provide: SalesRecordService, useValue: salesRecordService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<SpaceSessionSettlementService>(
      SpaceSessionSettlementService,
    );
    Object.assign(service as object, { logger });
  });

  it('settleSession 创建空间结账销售单时应开启当前班次归属', async () => {
    const user = createSpaceTestUser();
    const params = createSettleSpaceSessionParams();
    const createdOrder = createSalesOrderResponse();
    const updatedSession = createUpdatedSpaceSession();

    salesRecordService.create.mockResolvedValue(createdOrder);
    transactionClient.spaceSession.update.mockResolvedValue(updatedSession);
    transactionClient.space.update.mockResolvedValue({
      id: 7,
      status: PrismaSpaceStatus.cleaning,
    });
    transactionClient.spaceReservation.findMany.mockResolvedValue([]);
    transactionClient.spaceReservation.findFirst.mockResolvedValue(null);

    const result = await service.settleSession(user, params);

    expect(salesRecordService.create).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        storeId: 18,
        totalRevenue: 20,
        totalProfit: 8,
        totalQuantity: 1,
        paymentMethod: 'cash',
        date: params.checkoutAt,
      }),
      expectedSalesRecordCreateOptions,
    );
    expect(transactionClient.spaceSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          saleOrderId: 12,
        }),
      }),
    );
    expect(result).toMatchObject({
      salesOrder: createdOrder,
      cancelledReservationId: null,
      spaceStatus: PrismaSpaceStatus.cleaning,
    });
  });

  it('autoCheckoutExpiredCountdownSessions 会结账已到期的倒计时自动结账会话', async () => {
    const user = createSpaceTestUser();
    const session = createSpaceSessionRecord();
    const checkoutAt = new Date(2026, 5, 4, 10, 0, 0).getTime();
    const createdOrder = createSalesOrderResponse();
    const updatedSession = createUpdatedSpaceSession();

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
    salesRecordService.create.mockResolvedValue(createdOrder);
    transactionClient.spaceSession.update.mockResolvedValue(updatedSession);
    transactionClient.space.update.mockResolvedValue({
      id: 7,
      status: PrismaSpaceStatus.cleaning,
    });
    transactionClient.spaceReservation.findMany.mockResolvedValue([]);
    transactionClient.spaceReservation.findFirst.mockResolvedValue(null);

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
    expect(salesRecordService.create).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        paymentMethod: 'cash',
        date: checkoutAt,
        note: '倒计时到期自动结账',
      }),
      expectedSalesRecordCreateOptions,
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
    expect(salesRecordService.create).not.toHaveBeenCalled();
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
    salesRecordService.create.mockRejectedValueOnce(
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
    salesRecordService.create.mockRejectedValueOnce(
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
});
