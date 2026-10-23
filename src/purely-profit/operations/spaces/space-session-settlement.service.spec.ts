import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisService } from '../../../redis/redis.service';
import { SalesRecordService } from '../sales-record/sales-record.service';
import { SpaceSessionSaleOrderService } from './space-session-sale-order.service';
import { aUuid } from '../../../spec-matchers';
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
import { MarketingConsumptionLinkService } from '../../marketing/marketing-consumption-link.service';
import { CommissionCoreService } from '../commission/commission-core.service';
import { SpaceCareRecordWriterService } from './space-care-record-writer.service';

describe('SpaceSessionSettlementService', () => {
  let service: SpaceSessionSettlementService;

  const transactionClient = createSpaceTransactionClient();
  const prismaService = {
    $transaction: jest.fn(),
    // 纯利宝团购券反查（护理档案展示名）：默认无券不触发
    clubVoucherOrder: { findFirst: jest.fn() },
  };
  const salesRecordService = {
    create: jest.fn(),
  };
  const cacheInvalidatorService = {
    invalidateSalesDerived: jest.fn(),
    invalidateSpacesReadCaches: jest.fn(),
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
  // F9: 空间结算联动营销服务（本测试关注结算流程本身，联动逻辑由独立测试覆盖）
  const marketingConsumptionLinkService = {
    linkSpaceSettlementConsumption: jest.fn().mockResolvedValue(undefined),
    invalidateMarketingDerived: jest.fn().mockResolvedValue(undefined),
  };
  // 提成核心服务（本测试会话无提成分配，核心链路由独立测试覆盖）
  const commissionCoreService = {
    buildServicesMap: jest.fn(),
    resolveTechnicianNames: jest.fn(),
    normalizeAssignments: jest.fn(),
    recomputeAssignments: jest.fn(),
    createSettledRecords: jest.fn().mockResolvedValue(undefined),
    markSettledRecordsIncluded: jest.fn(),
    listConfigRecords: jest.fn(),
  };
  // 护理档案建档：本文件只断言「结账后是否以正确入参触发建档」，
  // 建档内部的 seq 自增 / 手机号三态 / 幂等由 space-care-record-writer.service.spec 覆盖。
  const careRecordWriterService = {
    writeAfterSettlement: jest
      .fn()
      .mockResolvedValue({ status: 'created', customerId: 55, seq: 1 }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    cacheInvalidatorService.invalidateSalesDerived.mockResolvedValue(undefined);
    cacheInvalidatorService.invalidateSpacesReadCaches.mockResolvedValue(
      undefined,
    );
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
        {
          provide: SalesRecordService,
          useValue: salesRecordService,
        },
        {
          // 使用真实包装器，让断言落到内部 SalesRecordService.create 的 3 参数签名上
          provide: SpaceSessionSaleOrderService,
          useFactory: () =>
            new SpaceSessionSaleOrderService(salesRecordService as never),
        },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
        { provide: RedisService, useValue: redisService },
        {
          provide: SpaceReservationsStateService,
          useValue: reservationsStateService,
        },
        {
          provide: MarketingConsumptionLinkService,
          useValue: marketingConsumptionLinkService,
        },
        {
          provide: CommissionCoreService,
          useValue: commissionCoreService,
        },
        {
          provide: SpaceCareRecordWriterService,
          useValue: careRecordWriterService,
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
    // BUG-1 fix: 事务内重读 sessionItems，mock 返回与 params.session.sessionItems 一致的数据
    transactionClient.spaceSessionItem.findMany.mockResolvedValue(
      params.session.sessionItems,
    );
    transactionClient.spaceSessionRenewRecord.findMany.mockResolvedValue([]);
    transactionClient.spaceSession.update.mockResolvedValue(updatedSession);
    transactionClient.spaceReservation.findMany.mockResolvedValue([]);
    transactionClient.spaceReservation.findFirst.mockResolvedValue(null);

    const result = await service.settleSession(user, params);

    expect(redisClient.set).toHaveBeenCalledWith(
      'space:settlement:session:9',
      aUuid,
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
    // F9: 空间结算联动营销中心——调用营销消费联动（事务内）并失效营销缓存
    expect(
      marketingConsumptionLinkService.linkSpaceSettlementConsumption,
    ).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        storeId: 18,
        guestName: '张三',
        guestPhone: '13800138000',
        paymentMethod: 'cash',
      }),
    );
    expect(
      marketingConsumptionLinkService.invalidateMarketingDerived,
    ).toHaveBeenCalledWith(18);
    expect(redisClient.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', KEYS[1]) == ARGV[1]"),
      1,
      'space:settlement:session:9',
      aUuid,
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
    transactionClient.spaceSessionItem.findMany.mockResolvedValue(
      params.session.sessionItems,
    );
    transactionClient.spaceSessionRenewRecord.findMany.mockResolvedValue([]);
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
        lineTotal: -30,
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
    // BUG-1 fix: 事务内重读 sessionItems，mock 返回含预付款抵扣项的数据
    transactionClient.spaceSessionItem.findMany.mockResolvedValue([
      ...params.session.sessionItems,
      {
        id: 2,
        sessionId: 9,
        productId: 'SYS_PREPAID_DEDUCTION',
        productName: '预付款',
        categoryName: '场地费',
        salePrice: -3000, // DB 存储为分（-30元）
        profit: -3000,
        quantity: 1,
        sortOrder: 1,
        createdAt: new Date(2026, 5, 4, 9, 0, 0),
      },
    ]);
    transactionClient.spaceSessionRenewRecord.findMany.mockResolvedValue([]);
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
    transactionClient.spaceSessionItem.findMany.mockResolvedValue(
      params.session.sessionItems,
    );
    transactionClient.spaceSessionRenewRecord.findMany.mockResolvedValue([]);
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

  describe('结账后置：会员护理档案建档', () => {
    /** 结账销售单（含 totalRevenue，护理档案的金额快照取自此字段） */
    const salesOrder = { ...createSalesOrderResponse(), totalRevenue: 20 };

    const arrangeSuccessfulSettlement = (
      params: ReturnType<typeof createSettleSpaceSessionParams>,
    ): void => {
      salesRecordService.create.mockResolvedValue(salesOrder);
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
      transactionClient.spaceSessionItem.findMany.mockResolvedValue(
        params.session.sessionItems,
      );
      transactionClient.spaceSessionRenewRecord.findMany.mockResolvedValue([]);
      transactionClient.spaceSession.update.mockResolvedValue(
        createUpdatedSpaceSession(),
      );
      transactionClient.spaceReservation.findMany.mockResolvedValue([]);
      transactionClient.spaceReservation.findFirst.mockResolvedValue(null);
    };

    it('结账成功后以场次手机号与结账快照触发建档（主链路）', async () => {
      const user = createSpaceTestUser();
      const params = createSettleSpaceSessionParams();
      params.requestId = 'req-settle-1';
      arrangeSuccessfulSettlement(params);

      await service.settleSession(user, params);

      expect(careRecordWriterService.writeAfterSettlement).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: 18,
          sessionId: 9,
          guestPhone: '13800138000',
          visitAt: params.checkoutAt,
          serviceName: '可乐',
          amountYuan: 20,
          technicianName: null,
          staffId: 8,
          requestId: 'req-settle-1',
        }),
      );
    });

    it('purelyClub 团购券开台：券商品名作为护理项目名，台位费行不出现在展示名里', async () => {
      const user = createSpaceTestUser();
      const params = createSettleSpaceSessionParams();
      // 团购券会话：会话行只落「台位费」计费行，券商品名来自 club_voucher_orders
      params.session.prepaidVoucherCode = 'VC202601';
      arrangeSuccessfulSettlement(params);
      transactionClient.spaceSession.update.mockResolvedValue({
        ...createUpdatedSpaceSession(),
        prepaidVoucherCode: 'VC202601',
        sessionItems: [
          {
            id: 1,
            sessionId: 9,
            productId: 'SYS_TIME_BILLING',
            productName: '台位费 1分钟',
            categoryName: '场地费',
            salePrice: 129,
            profit: 129,
            quantity: 1,
            sortOrder: 0,
            createdAt: new Date(2026, 5, 4, 9, 0, 0),
          },
        ],
      });
      prismaService.clubVoucherOrder.findFirst.mockResolvedValue({
        productName: '泡沐浴盐护理',
      });

      await service.settleSession(user, params);

      expect(prismaService.clubVoucherOrder.findFirst).toHaveBeenCalledWith({
        where: { storeId: 18, voucherCode: 'VC202601' },
        // 券单商品名与成本快照同次查询（成本用于券面行利润口径）
        select: {
          productName: true,
          productPrice: true,
          productCostPrice: true,
        },
      });
      expect(careRecordWriterService.writeAfterSettlement).toHaveBeenCalledWith(
        expect.objectContaining({
          storeId: 18,
          sessionId: 9,
          serviceName: '泡沐浴盐护理',
          amountYuan: 20,
        }),
      );
    });

    it('匹配不到会员（建档跳过）时结账结果不受影响', async () => {
      const user = createSpaceTestUser();
      const params = createSettleSpaceSessionParams();
      arrangeSuccessfulSettlement(params);
      careRecordWriterService.writeAfterSettlement.mockResolvedValueOnce({
        status: 'skipped',
        reason: 'customer-not-found',
      });

      const result = await service.settleSession(user, params);

      expect(careRecordWriterService.writeAfterSettlement).toHaveBeenCalled();
      expect(result.salesOrder).toEqual(salesOrder);
      expect(result.session.status).toBe('settled');
    });

    it('建档失败（系统异常）不回滚已提交的结账', async () => {
      const user = createSpaceTestUser();
      const params = createSettleSpaceSessionParams();
      arrangeSuccessfulSettlement(params);
      careRecordWriterService.writeAfterSettlement.mockResolvedValueOnce({
        status: 'failed',
        reason: 'P2002',
      });

      const result = await service.settleSession(user, params);

      expect(result.salesOrder).toEqual(salesOrder);
      expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
