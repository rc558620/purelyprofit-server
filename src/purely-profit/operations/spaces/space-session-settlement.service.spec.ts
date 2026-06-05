import { Test, TestingModule } from '@nestjs/testing';
import { SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
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

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.spaceSession.findUnique.mockResolvedValue({
      status: 'active',
    });
    prismaService.spaceSession.findMany.mockResolvedValue([]);
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
    expect(result).toBe(1);
  });
});
