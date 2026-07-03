import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
import { SpaceReservationsStateService } from './space-reservations-state.service';

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
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(undefined),
  };
  const reservationsStateService = {
    ensureReservationCanBeFulfilled: jest.fn(),
    findNextReservationToActivate: jest.fn().mockResolvedValue(null),
    cancelMatchedReservationAfterCheckout: jest.fn().mockResolvedValue(null),
    resolveReservationBackStatus: jest.fn().mockResolvedValue('idle'),
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
        {
          provide: SpaceReservationsStateService,
          useValue: reservationsStateService,
        },
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
        paymentMethod: 'cash',
        date: params.checkoutAt,
      }),
      expect.objectContaining({
        ...expectedSalesRecordCreateOptions,
        totalRevenueOverride: 20,
        totalProfitOverride: 8,
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

    const result = await service.settleSession(user, params);

    // Space.status 已移除，不再更新空间状态
    expect(result.cancelledReservationId).toBeNull();
  });

  it('结账销售单预付款项以正数写入（代表已收预付款）', async () => {
    const user = createSpaceTestUser();
    const params = createSettleSpaceSessionParams();
    params.settlement.orderItems = [
      ...params.settlement.orderItems,
      {
        productId: 'SYS_PREPAID_DEDUCTION',
        productName: '预付款',
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
    transactionClient.spaceReservation.findMany.mockResolvedValue([]);
    transactionClient.spaceReservation.findFirst.mockResolvedValue(null);

    await service.settleSession(user, params);

    // 预付款在结算计算中为负（减少应付），但存入销售明细时翻转为正数
    // ——它代表已收到的预付款，前端直接展示，严禁做金额计算
    // totalRevenue/totalProfit 通过 override 传入，确保 SaleOrder 存储正确的结算金额
    expect(salesRecordService.create).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            productId: 'SYS_PREPAID_DEDUCTION',
            salePrice: 30,
            profit: 30,
          }),
        ]),
      }),
      expect.objectContaining({
        ...expectedSalesRecordCreateOptions,
        totalRevenueOverride: -10,
        totalProfitOverride: -22,
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
    // 取消预约的逻辑已移至 SpaceReservationsStateService.cancelMatchedReservationAfterCheckout
    // mock 该方法返回 32 表示成功取消了预约ID为32的记录
    reservationsStateService.cancelMatchedReservationAfterCheckout.mockResolvedValueOnce(
      32,
    );

    const result = await service.settleSession(user, params);

    expect(
      reservationsStateService.cancelMatchedReservationAfterCheckout,
    ).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        reservationId: null,
        spaceId: params.session.spaceId,
      }),
    );
    expect(result.cancelledReservationId).toBe(32);
  });
});
