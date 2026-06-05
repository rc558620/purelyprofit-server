import { Test, TestingModule } from '@nestjs/testing';
import { SpaceStatus } from '@prisma/client';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesRecordService } from '../sales-record/sales-record.service';
import { SpaceSessionCheckoutLockService } from './space-session-checkout-lock.service';
import { SpaceSessionCheckoutService } from './space-session-checkout.service';
import { SpaceSessionSettlementService } from './space-session-settlement.service';
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
    },
    $transaction: jest.fn(),
  };
  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
  };
  const checkoutLockService = {
    requireValidLock: jest.fn(),
    deleteLock: jest.fn(),
  };
  const salesRecordService = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
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
      ],
    }).compile();

    service = module.get<SpaceSessionCheckoutService>(
      SpaceSessionCheckoutService,
    );
  });

  it('checkout 应串起 settlement 并透传当前班次归属到销售记录创建', async () => {
    const user = createSpaceTestUser();
    const checkoutAt = createSpaceCheckoutAt();
    const session = createSpaceSessionRecord();
    const createdOrder = createSalesOrderResponse();
    const updatedSession = createUpdatedSpaceSession();

    prismaService.spaceSession.findUnique.mockResolvedValue(session);
    checkoutLockService.requireValidLock.mockResolvedValue({
      sessionId: 9,
      lockId: 'lock_1',
      lockedAt: checkoutAt,
      expiresAt: checkoutAt + 5 * 60 * 1000,
      sessionUpdatedAt: session.updatedAt.getTime(),
    });
    salesRecordService.create.mockResolvedValue(createdOrder);
    transactionClient.spaceSession.update.mockResolvedValue(updatedSession);
    transactionClient.space.update.mockResolvedValue({
      id: 7,
      status: SpaceStatus.cleaning,
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
        totalRevenue: 20,
        totalProfit: 8,
        totalQuantity: 1,
        paymentMethod: 'cash',
        date: checkoutAt,
      }),
      expectedSalesRecordCreateOptions,
    );
    expect(checkoutLockService.deleteLock).toHaveBeenCalledWith('lock_1');
    expect(result).toMatchObject({
      session: {
        id: '9',
        orderId: '12',
        status: 'settled',
      },
      spaceStatus: 'cleaning',
      salesOrder: createdOrder,
    });
  });
});
