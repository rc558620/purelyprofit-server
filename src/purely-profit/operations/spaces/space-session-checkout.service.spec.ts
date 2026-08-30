import { Test, TestingModule } from '@nestjs/testing';

import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RedisService } from '../../../redis/redis.service';
import { SalesRecordService } from '../sales-record/sales-record.service';
import { SpaceSessionCheckoutLockService } from './space-session-checkout-lock.service';
import { SpaceSessionCheckoutService } from './space-session-checkout.service';
import { SpaceSessionSettlementService } from './space-session-settlement.service';
import { SpaceSessionSaleOrderService } from './space-session-sale-order.service';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { MarketingConsumptionLinkService } from '../../marketing/marketing-consumption-link.service';
import { CommissionCoreService } from '../commission/commission-core.service';
import {
  createSalesOrderResponse,
  createSpaceCheckoutAt,
  createSpaceSessionRecord,
  createSpaceTestUser,
  createSpaceTransactionClient,
  createUpdatedSpaceSession,
  expectedSalesRecordCreateOptions,
} from './space-session.spec-helpers';

describe('SpaceSessionCheckoutService', () => {
  let service: SpaceSessionCheckoutService;

  const transactionClient = createSpaceTransactionClient();
  const prismaService = {
    spaceSession: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
  };
  const checkoutLockService = {
    createLock: jest.fn(),
    requireValidLock: jest.fn(),
    deleteLock: jest.fn(),
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
  const commissionCoreService = {
    buildServicesMap: jest.fn(),
    resolveTechnicianNames: jest.fn(),
    normalizeAssignments: jest.fn(),
    recomputeAssignments: jest.fn(),
    createSettledRecords: jest.fn().mockResolvedValue(undefined),
    markSettledRecordsIncluded: jest.fn(),
    listConfigRecords: jest.fn(),
  };
  const marketingConsumptionLinkService = {
    linkSpaceSettlementConsumption: jest.fn().mockResolvedValue(undefined),
    invalidateMarketingDerived: jest.fn().mockResolvedValue(undefined),
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
        SpaceSessionCheckoutService,
        SpaceSessionSettlementService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: SpaceSessionCheckoutLockService,
          useValue: checkoutLockService,
        },
        { provide: SalesRecordService, useValue: salesRecordService },
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
          useValue: {
            ensureReservationCanBeFulfilled: jest.fn(),
            findNextReservationToActivate: jest.fn().mockResolvedValue(null),
            cancelMatchedReservationAfterCheckout: jest
              .fn()
              .mockResolvedValue(null),
            resolveReservationBackStatus: jest.fn().mockResolvedValue('idle'),
          },
        },
        {
          provide: CommissionCoreService,
          useValue: commissionCoreService,
        },
        {
          provide: MarketingConsumptionLinkService,
          useValue: marketingConsumptionLinkService,
        },
      ],
    }).compile();

    service = module.get<SpaceSessionCheckoutService>(
      SpaceSessionCheckoutService,
    );
  });

  it('countdown 固定台位费预览应直接返回预付款后的金额', async () => {
    const user = createSpaceTestUser();
    const checkoutAt = createSpaceCheckoutAt();
    const baseSession = createSpaceSessionRecord();
    const session = {
      ...baseSession,
      billingMode: 'countdown' as const,
      hourlyRate: 77700, // DB 存储为分（777元）
      countdownMinutes: 60,
      autoCheckout: false,
      prepaidPaymentMethod: 'cash' as const,
      prepaidAmount: 99900, // DB 存储为分（999元）
    };

    prismaService.spaceSession.findFirst.mockResolvedValue(session);
    checkoutLockService.createLock.mockResolvedValue({
      lockId: 'lock_preview_1',
      expiresAt: checkoutAt + 5 * 60 * 1000,
    });

    jest.spyOn(Date, 'now').mockReturnValue(checkoutAt);

    const result = await service.previewSpaceSessionCheckout(user, 9, {
      timeFeeMode: 'unit_price',
      countdownFeeMode: 'fixed',
    });

    expect(result).toMatchObject({
      lockId: 'lock_preview_1',
      lockedAt: checkoutAt,
      expiresAt: checkoutAt + 5 * 60 * 1000,
      preview: {
        timeCost: 777, // 77700分 = 777元
        itemsCost: 20, // 2000分 = 20元
        renewDeduction: 0,
        prepaidDeduction: 999, // 99900分 = 999元
        totalAmount: -202, // 777 + 20 - 999 = -202元
        timeFeeMode: 'unit_price',
        countdownFeeMode: 'fixed',
      },
    });

    jest.restoreAllMocks();
  });

  it('timed 会话在按实际计时与按单价预览下都应扣减开台已收款', async () => {
    const user = createSpaceTestUser();
    const checkoutAt = createSpaceCheckoutAt();
    const baseSession = createSpaceSessionRecord();
    const session = {
      ...baseSession,
      startTime: new Date(2026, 5, 4, 9, 20, 0),
      billingMode: 'timed' as const,
      hourlyRate: 77700, // DB 存储为分（777元）
      sessionItems: [],
      itemsCost: 0, // DB 存储为分（0元）
      prepaidPaymentMethod: 'card' as const,
      prepaidAmount: 150000, // DB 存储为分（1500元）
    };

    prismaService.spaceSession.findFirst.mockResolvedValue(session);
    checkoutLockService.createLock
      .mockResolvedValueOnce({
        lockId: 'lock_preview_timed',
        expiresAt: checkoutAt + 5 * 60 * 1000,
      })
      .mockResolvedValueOnce({
        lockId: 'lock_preview_unit_price',
        expiresAt: checkoutAt + 5 * 60 * 1000,
      });

    jest.spyOn(Date, 'now').mockReturnValue(checkoutAt);

    const timedResult = await service.previewSpaceSessionCheckout(user, 9, {
      timeFeeMode: 'timed',
      countdownFeeMode: 'timed',
    });
    const unitPriceResult = await service.previewSpaceSessionCheckout(user, 9, {
      timeFeeMode: 'unit_price',
      countdownFeeMode: 'fixed',
    });

    expect(timedResult.preview).toMatchObject({
      durationMinutes: 70,
      timeCost: 906.51, // 70/60*777*100 因浮点精度 Math.ceil(90650.00...01) = 90651 / 100 = 906.51
      itemsCost: 0,
      prepaidDeduction: 1500, // 150000分 = 1500元
      totalAmount: -593.49, // 906.51 + 0 - 1500 = -593.49
      timeFeeMode: 'timed',
      countdownFeeMode: 'timed',
    });
    expect(unitPriceResult.preview).toMatchObject({
      durationMinutes: 70,
      timeCost: 777, // 77700分 = 777元
      itemsCost: 0,
      prepaidDeduction: 1500, // 150000分 = 1500元
      totalAmount: -723, // 777 + 0 - 1500 = -723元
      timeFeeMode: 'unit_price',
      countdownFeeMode: 'fixed',
    });

    jest.restoreAllMocks();
  });

  it('checkout 应串起 settlement 并透传当前班次归属到销售记录创建', async () => {
    const user = createSpaceTestUser();
    const checkoutAt = createSpaceCheckoutAt();
    const session = createSpaceSessionRecord();
    const createdOrder = createSalesOrderResponse();
    const updatedSession = createUpdatedSpaceSession();

    prismaService.spaceSession.findFirst.mockResolvedValue(session);
    checkoutLockService.requireValidLock.mockResolvedValue({
      sessionId: 9,
      lockId: 'lock_1',
      lockedAt: checkoutAt,
      expiresAt: checkoutAt + 5 * 60 * 1000,
      sessionUpdatedAt: session.updatedAt.getTime(),
    });
    salesRecordService.create.mockResolvedValue(createdOrder);
    transactionClient.$queryRaw.mockResolvedValue(undefined);
    transactionClient.spaceSession.findUnique.mockResolvedValue({
      status: 'active',
      updatedAt: session.updatedAt,
      reservationId: session.reservationId,
      guestName: session.guestName,
      guestPhone: session.guestPhone,
      startTime: session.startTime,
      spaceId: session.spaceId,
    });
    transactionClient.space.findUnique.mockResolvedValue({
      id: 7,
      enableDirtyRoom: true,
    });
    // BUG-1 fix: 事务内重读 sessionItems
    transactionClient.spaceSessionItem.findMany.mockResolvedValue(
      session.sessionItems,
    );
    transactionClient.spaceSessionRenewRecord.findMany.mockResolvedValue([]);
    transactionClient.spaceSession.update.mockResolvedValue(updatedSession);
    transactionClient.space.update.mockResolvedValue({
      id: 7,
      // status 字段已移除
    });
    transactionClient.spaceReservation.findMany.mockResolvedValue([]);
    transactionClient.spaceReservation.findFirst.mockResolvedValue(null);

    const result = await service.checkoutSpaceSession(user, 9, {
      paymentMethod: 'cash',
      lockId: 'lock_1',
      lockedAt: checkoutAt,
    });

    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'operation-entry:create',
      '无权在该门店空间结账',
    );
    expect(salesRecordService.create).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        storeId: 18,
        items: [
          {
            productId: '201',
            productName: '可乐',
            categoryName: '饮品',
            salePrice: 20,
            profit: 8,
            quantity: 1,
          },
        ],
        paymentMethod: 'cash',
        date: checkoutAt,
      }),
      expect.objectContaining({
        ...expectedSalesRecordCreateOptions,
        totalRevenueOverride: 20,
        totalProfitOverride: 8,
        transactionClient,
      }),
    );
    expect(cacheInvalidatorService.invalidateSalesDerived).toHaveBeenCalledWith(
      18,
    );
    expect(checkoutLockService.deleteLock).toHaveBeenCalledWith('lock_1');
    expect(result).toMatchObject({
      session: {
        id: '9',
        orderId: '12',
        status: 'settled',
      },
      spaceStatus: 'idle',
      salesOrder: createdOrder,
    });
  });

  it('手动结账倒计时在按实际计时时也应抵扣开台预付款', async () => {
    const user = createSpaceTestUser();
    const checkoutAt = createSpaceCheckoutAt();
    const baseSession = createSpaceSessionRecord();
    const baseUpdatedSession = createUpdatedSpaceSession();
    const session = {
      ...baseSession,
      billingMode: 'countdown' as const,
      hourlyRate: 6000, // DB 存储为分（60元）
      countdownMinutes: 60,
      autoCheckout: false,
      prepaidPaymentMethod: 'cash' as const,
      prepaidAmount: 3000, // DB 存储为分（30元）
      space: {
        ...baseSession.space,
        enableDirtyRoom: true,
      },
    };
    const updatedSession = {
      ...baseUpdatedSession,
      billingMode: 'countdown' as const,
      hourlyRate: 6000, // DB 存储为分（60元）
      countdownMinutes: 60,
      autoCheckout: false,
      prepaidPaymentMethod: 'cash' as const,
      prepaidAmount: 3000, // DB 存储为分（30元）
      space: {
        ...baseUpdatedSession.space,
        enableDirtyRoom: true,
      },
    };
    const createdOrder = createSalesOrderResponse();

    prismaService.spaceSession.findFirst.mockResolvedValue(session);
    checkoutLockService.requireValidLock.mockResolvedValue({
      sessionId: 9,
      lockId: 'lock_2',
      lockedAt: checkoutAt,
      expiresAt: checkoutAt + 5 * 60 * 1000,
      sessionUpdatedAt: session.updatedAt.getTime(),
      timeFeeMode: 'timed',
      countdownFeeMode: 'timed',
    });
    salesRecordService.create.mockResolvedValue(createdOrder);
    transactionClient.$queryRaw.mockResolvedValue(undefined);
    transactionClient.spaceSession.findUnique.mockResolvedValue({
      status: 'active',
      updatedAt: session.updatedAt,
      reservationId: session.reservationId,
      guestName: session.guestName,
      guestPhone: session.guestPhone,
      startTime: session.startTime,
      spaceId: session.spaceId,
    });
    transactionClient.space.findUnique.mockResolvedValue({
      id: 7,
      enableDirtyRoom: true,
    });
    // BUG-1 fix: 事务内重读 sessionItems
    transactionClient.spaceSessionItem.findMany.mockResolvedValue(
      session.sessionItems,
    );
    transactionClient.spaceSessionRenewRecord.findMany.mockResolvedValue([]);
    transactionClient.spaceSession.update.mockResolvedValue(updatedSession);
    transactionClient.space.update.mockResolvedValue({
      id: 7,
      // status 字段已移除
    });
    transactionClient.spaceReservation.findMany.mockResolvedValue([]);
    transactionClient.spaceReservation.findFirst.mockResolvedValue(null);

    await service.checkoutSpaceSession(user, 9, {
      paymentMethod: 'cash',
      lockId: 'lock_2',
      lockedAt: checkoutAt,
      timeFeeMode: 'timed',
      countdownFeeMode: 'timed',
    });

    expect(salesRecordService.create).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            productId: 'SYS_PREPAID_DEDUCTION',
            productName: '预付款',
            salePrice: 30,
            profit: 30,
            quantity: 1,
          }),
        ]),
      }),
      expect.objectContaining({
        ...expectedSalesRecordCreateOptions,
        totalRevenueOverride: 80,
        totalProfitOverride: 68,
        transactionClient,
      }),
    );
  });
});
