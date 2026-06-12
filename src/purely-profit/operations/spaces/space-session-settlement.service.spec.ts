import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisService } from '../../../redis/redis.service';
import { SalesRecordService } from '../sales-record/sales-record.service';
import {
  createSalesOrderResponse,
  createSettleSpaceSessionParams,
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
    $transaction: jest.fn(),
  };
  const salesRecordService = {
    create: jest.fn(),
  };
  const cacheInvalidatorService = {
    invalidateSalesDerived: jest.fn(),
  };
  const redisClient = {
    set: jest.fn(),
    eval: jest.fn(),
  };
  const redisService = {
    getClient: jest.fn(() => redisClient),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    cacheInvalidatorService.invalidateSalesDerived.mockResolvedValue(undefined);
    redisClient.set.mockResolvedValue('OK');
    redisClient.eval.mockResolvedValue(1);
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
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<SpaceSessionSettlementService>(
      SpaceSessionSettlementService,
    );
  });

  it('settleSession 创建空间结账销售单时应开启当前班次归属', async () => {
    const user = createSpaceTestUser();
    const params = createSettleSpaceSessionParams();
    const createdOrder = createSalesOrderResponse();
    const updatedSession = createUpdatedSpaceSession();

    salesRecordService.create.mockResolvedValue(createdOrder);
    transactionClient.$queryRaw.mockResolvedValue(undefined);
    transactionClient.spaceSession.findUnique.mockResolvedValue({
      status: 'active',
      updatedAt: params.session.updatedAt,
      reservationId: params.session.reservationId,
      guestName: params.session.guestName,
      guestPhone: params.session.guestPhone,
      startTime: params.session.startTime,
      spaceId: params.session.spaceId,
    });
    transactionClient.space.findUnique.mockResolvedValue({
      id: 7,
      enableDirtyRoom: true,
    });
    transactionClient.spaceSession.update.mockResolvedValue(updatedSession);
    transactionClient.space.update.mockResolvedValue({
      id: 7,
      status: PrismaSpaceStatus.cleaning,
    });
    transactionClient.spaceReservation.findMany.mockResolvedValue([]);
    transactionClient.spaceReservation.findFirst.mockResolvedValue(null);

    const result = await service.settleSession(user, params);

    expect(redisClient.set).toHaveBeenCalledWith(
      'space:settlement:session:9',
      expect.any(String),
      'EX',
      30,
      'NX',
    );
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
      expect.objectContaining({
        ...expectedSalesRecordCreateOptions,
        transactionClient,
      }),
    );
    expect(transactionClient.spaceSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          saleOrderId: 12,
        }),
      }),
    );
    expect(cacheInvalidatorService.invalidateSalesDerived).toHaveBeenCalledWith(
      18,
    );
    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', KEYS[1]) == ARGV[1]"),
      1,
      'space:settlement:session:9',
      expect.any(String),
    );
    expect(result).toMatchObject({
      salesOrder: createdOrder,
      cancelledReservationId: null,
      spaceStatus: PrismaSpaceStatus.cleaning,
    });
  });

  it('settleSession 应基于事务内最新空间配置决定结账后状态', async () => {
    const user = createSpaceTestUser();
    const params = createSettleSpaceSessionParams();
    const createdOrder = createSalesOrderResponse();
    const updatedSession = createUpdatedSpaceSession();

    salesRecordService.create.mockResolvedValue(createdOrder);
    transactionClient.$queryRaw.mockResolvedValue(undefined);
    transactionClient.spaceSession.findUnique.mockResolvedValue({
      status: 'active',
      updatedAt: params.session.updatedAt,
      reservationId: params.session.reservationId,
      guestName: params.session.guestName,
      guestPhone: params.session.guestPhone,
      startTime: params.session.startTime,
      spaceId: params.session.spaceId,
    });
    transactionClient.space.findUnique.mockResolvedValue({
      id: 7,
      enableDirtyRoom: false,
    });
    transactionClient.spaceSession.update.mockResolvedValue(updatedSession);
    transactionClient.spaceReservation.findMany.mockResolvedValue([]);
    transactionClient.spaceReservation.findFirst.mockResolvedValue(null);
    transactionClient.space.update.mockResolvedValue({
      id: 7,
      status: PrismaSpaceStatus.idle,
    });

    const result = await service.settleSession(user, params);

    expect(transactionClient.space.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        status: PrismaSpaceStatus.idle,
      },
    });
    expect(result.spaceStatus).toBe(PrismaSpaceStatus.idle);
  });

  it('结账销售单可写入预付抵扣负项', async () => {
    const user = createSpaceTestUser();
    const params = createSettleSpaceSessionParams();
    params.settlement.orderItems = [
      ...params.settlement.orderItems,
      {
        productId: 'SYS_PREPAID_DEDUCTION',
        productName: '预付抵扣',
        categoryName: '场地费',
        salePrice: -30,
        profit: -30,
        quantity: 1,
      },
    ];
    params.settlement.prepaidDeduction = 30;
    params.settlement.totalAmount = -10;
    params.settlement.totalRevenue = -10;
    params.settlement.totalProfit = -22;
    params.settlement.totalQuantity = 1;
    const createdOrder = createSalesOrderResponse();
    const updatedSession = createUpdatedSpaceSession();

    salesRecordService.create.mockResolvedValue(createdOrder);
    transactionClient.$queryRaw.mockResolvedValue(undefined);
    transactionClient.spaceSession.findUnique.mockResolvedValue({
      status: 'active',
      updatedAt: params.session.updatedAt,
      reservationId: params.session.reservationId,
      guestName: params.session.guestName,
      guestPhone: params.session.guestPhone,
      startTime: params.session.startTime,
      spaceId: params.session.spaceId,
    });
    transactionClient.space.findUnique.mockResolvedValue({
      id: 7,
      enableDirtyRoom: true,
    });
    transactionClient.spaceSession.update.mockResolvedValue(updatedSession);
    transactionClient.space.update.mockResolvedValue({
      id: 7,
      status: PrismaSpaceStatus.cleaning,
    });
    transactionClient.spaceReservation.findMany.mockResolvedValue([]);
    transactionClient.spaceReservation.findFirst.mockResolvedValue(null);

    await service.settleSession(user, params);

    expect(salesRecordService.create).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            productId: 'SYS_PREPAID_DEDUCTION',
            salePrice: -30,
            profit: -30,
          }),
        ]),
        totalRevenue: -10,
        totalProfit: -22,
      }),
      expect.objectContaining({
        ...expectedSalesRecordCreateOptions,
        transactionClient,
      }),
    );
  });

  it('settleSession 在执行锁已被占用时应快速失败', async () => {
    const user = createSpaceTestUser();
    const params = createSettleSpaceSessionParams();

    redisClient.set.mockResolvedValueOnce(null);

    await expect(service.settleSession(user, params)).rejects.toThrow(
      new ConflictException('当前会话正在结账中，请稍后重试'),
    );
    expect(prismaService.$transaction).not.toHaveBeenCalled();
    expect(salesRecordService.create).not.toHaveBeenCalled();
  });

  it('settleSession 取消预约时不应覆盖并发已变更状态', async () => {
    const user = createSpaceTestUser();
    const params = createSettleSpaceSessionParams();
    params.session.reservationId = null;
    const createdOrder = createSalesOrderResponse();
    const updatedSession = createUpdatedSpaceSession();

    salesRecordService.create.mockResolvedValue(createdOrder);
    transactionClient.$queryRaw.mockResolvedValue(undefined);
    transactionClient.spaceSession.findUnique.mockResolvedValue({
      status: 'active',
      updatedAt: params.session.updatedAt,
      reservationId: null,
      guestName: params.session.guestName,
      guestPhone: params.session.guestPhone,
      startTime: params.session.startTime,
      spaceId: params.session.spaceId,
    });
    transactionClient.space.findUnique.mockResolvedValue({
      id: 7,
      enableDirtyRoom: true,
    });
    transactionClient.spaceSession.update.mockResolvedValue(updatedSession);
    transactionClient.space.update.mockResolvedValue({
      id: 7,
      status: PrismaSpaceStatus.cleaning,
    });
    transactionClient.spaceReservation.findMany.mockResolvedValue([
      {
        id: 31,
        reservedAt: new Date('2026-06-04T09:05:00.000Z'),
      },
      {
        id: 32,
        reservedAt: new Date('2026-06-04T09:10:00.000Z'),
      },
    ]);
    transactionClient.spaceReservation.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    transactionClient.spaceReservation.findFirst.mockResolvedValue(null);

    const result = await service.settleSession(user, params);

    expect(
      transactionClient.spaceReservation.updateMany,
    ).toHaveBeenNthCalledWith(1, {
      where: {
        id: 31,
        status: 'pending',
      },
      data: {
        status: 'cancelled',
      },
    });
    expect(
      transactionClient.spaceReservation.updateMany,
    ).toHaveBeenNthCalledWith(2, {
      where: {
        id: 32,
        status: 'pending',
      },
      data: {
        status: 'cancelled',
      },
    });
    expect(result.cancelledReservationId).toBe(32);
  });
});
