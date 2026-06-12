import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, SpaceBillingMode, SpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SpaceSessionRenewService } from './space-session-renew.service';
import { SpaceSessionWriteService } from './space-session-write.service';
import { parseSpaceSessionItems } from './space-sessions.mapper';
import { createSpaceTestUser } from './space-session.spec-helpers';

describe('SpaceSession concurrency fixes', () => {
  const user: AuthenticatedUser = createSpaceTestUser();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('SpaceSessionRenewService', () => {
    let service: SpaceSessionRenewService;

    const transaction = {
      $queryRaw: jest.fn(),
      spaceSession: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const prismaService = {
      spaceSession: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const commerceAccessService = {
      ensureCanAccessStore: jest.fn(),
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      prismaService.$transaction.mockImplementation((callback) =>
        Promise.resolve(callback(transaction)),
      );
      commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SpaceSessionRenewService,
          { provide: PrismaService, useValue: prismaService },
          { provide: CommerceAccessService, useValue: commerceAccessService },
        ],
      }).compile();

      service = module.get<SpaceSessionRenewService>(SpaceSessionRenewService);
    });

    it('续费时应基于事务内最新会话合并倒计时与续费记录', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_717_000_000_000);
      jest.spyOn(Math, 'random').mockReturnValue(0.123456);

      prismaService.spaceSession.findUnique.mockResolvedValue({
        id: 9,
        storeId: 18,
      });
      transaction.spaceSession.findUnique.mockResolvedValue({
        id: 9,
        storeId: 18,
        spaceId: 7,
        reservationId: null,
        guestName: '张三',
        guestPhone: '13800138000',
        guestCount: 2,
        startTime: new Date('2026-06-07T10:00:00.000Z'),
        endTime: null,
        billingMode: SpaceBillingMode.countdown,
        hourlyRate: new Prisma.Decimal(68),
        timeCost: null,
        countdownMinutes: 86,
        autoCheckout: false,
        prepaidPaymentMethod: null,
        prepaidCustomerPaymentMethod: null,
        prepaidSettlementChannel: null,
        prepaidGrouponCode: null,
        prepaidGrouponPlatform: null,
        prepaidVoucherCode: null,
        prepaidVoucherPlatform: null,
        prepaidNote: null,
        prepaidAmount: null,
        prepaidVoucherFaceAmount: null,
        items: [],
        itemsCost: new Prisma.Decimal(0),
        renewRecords: [
          {
            id: 'rn_existing',
            amount: 30,
            addedMinutes: 26,
            paymentMethod: 'cash',
            renewedAt: 1_716_000_000_000,
          },
        ],
        status: SpaceSessionStatus.active,
        saleOrderId: null,
        createdAt: new Date('2026-06-07T10:00:00.000Z'),
        updatedAt: new Date('2026-06-07T10:26:00.000Z'),
        space: {
          id: 7,
          name: 'A01',
          type: {
            name: '台球桌',
          },
        },
      });
      transaction.spaceSession.update.mockImplementation(({ data }) => ({
        id: 9,
        storeId: 18,
        spaceId: 7,
        reservationId: null,
        guestName: '张三',
        guestPhone: '13800138000',
        guestCount: 2,
        startTime: new Date('2026-06-07T10:00:00.000Z'),
        endTime: null,
        billingMode: SpaceBillingMode.countdown,
        hourlyRate: new Prisma.Decimal(68),
        timeCost: null,
        countdownMinutes: data.countdownMinutes,
        autoCheckout: false,
        prepaidPaymentMethod: null,
        prepaidCustomerPaymentMethod: null,
        prepaidSettlementChannel: null,
        prepaidGrouponCode: null,
        prepaidGrouponPlatform: null,
        prepaidVoucherCode: null,
        prepaidVoucherPlatform: null,
        prepaidNote: null,
        prepaidAmount: null,
        prepaidVoucherFaceAmount: null,
        items: [],
        itemsCost: new Prisma.Decimal(0),
        renewRecords: data.renewRecords,
        status: SpaceSessionStatus.active,
        saleOrderId: null,
        createdAt: new Date('2026-06-07T10:00:00.000Z'),
        updatedAt: new Date('2026-06-07T10:52:00.000Z'),
        space: {
          id: 7,
          name: 'A01',
          type: {
            name: '台球桌',
          },
        },
      }));

      const result = await service.renewSession(user, 9, {
        amount: 30,
        paymentMethod: 'cash',
      });

      expect(transaction.$queryRaw).toHaveBeenCalled();
      expect(transaction.spaceSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 9 },
          data: expect.objectContaining({
            countdownMinutes: 112,
          }),
        }),
      );
      expect(result.session.countdownMinutes).toBe(112);
      expect(result.session.renewRecords).toHaveLength(2);
      expect(result.renewRecord.amount).toBe(30);
      expect(result.renewRecord.addedMinutes).toBe(26);
    });
  });

  describe('SpaceSessionWriteService', () => {
    let service: SpaceSessionWriteService;

    const transaction = {
      $queryRaw: jest.fn(),
      spaceSession: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const prismaService = {
      spaceSession: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const deps = {
      ensureCanAccessStore: jest.fn(),
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      prismaService.$transaction.mockImplementation((callback) =>
        Promise.resolve(callback(transaction)),
      );
      deps.ensureCanAccessStore.mockResolvedValue(undefined);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SpaceSessionWriteService,
          { provide: PrismaService, useValue: prismaService },
        ],
      }).compile();

      service = module.get<SpaceSessionWriteService>(SpaceSessionWriteService);
    });

    it('追加商品时应基于事务内最新商品行合并 items', async () => {
      prismaService.spaceSession.findUnique.mockResolvedValue({
        id: 9,
        storeId: 18,
      });
      transaction.spaceSession.findUnique.mockResolvedValue({
        id: 9,
        storeId: 18,
        spaceId: 7,
        reservationId: null,
        guestName: '张三',
        guestPhone: '13800138000',
        guestCount: 2,
        startTime: new Date('2026-06-07T10:00:00.000Z'),
        endTime: null,
        billingMode: SpaceBillingMode.mixed,
        hourlyRate: new Prisma.Decimal(68),
        timeCost: null,
        countdownMinutes: null,
        autoCheckout: false,
        prepaidPaymentMethod: null,
        prepaidCustomerPaymentMethod: null,
        prepaidSettlementChannel: null,
        prepaidGrouponCode: null,
        prepaidGrouponPlatform: null,
        prepaidVoucherCode: null,
        prepaidVoucherPlatform: null,
        prepaidNote: null,
        prepaidAmount: null,
        prepaidVoucherFaceAmount: null,
        items: [
          {
            productId: 'prod_a',
            productName: '可乐',
            categoryName: '饮品',
            salePrice: 10,
            profit: 4,
            quantity: 1,
          },
        ],
        itemsCost: new Prisma.Decimal(10),
        renewRecords: [],
        status: SpaceSessionStatus.active,
        saleOrderId: null,
        createdAt: new Date('2026-06-07T10:00:00.000Z'),
        updatedAt: new Date('2026-06-07T10:20:00.000Z'),
        space: {
          id: 7,
          name: 'A01',
          type: {
            name: '台球桌',
          },
        },
      });
      transaction.spaceSession.update.mockImplementation(({ data }) => ({
        id: 9,
        storeId: 18,
        spaceId: 7,
        reservationId: null,
        guestName: '张三',
        guestPhone: '13800138000',
        guestCount: 2,
        startTime: new Date('2026-06-07T10:00:00.000Z'),
        endTime: null,
        billingMode: SpaceBillingMode.mixed,
        hourlyRate: new Prisma.Decimal(68),
        timeCost: null,
        countdownMinutes: null,
        autoCheckout: false,
        prepaidPaymentMethod: null,
        prepaidCustomerPaymentMethod: null,
        prepaidSettlementChannel: null,
        prepaidGrouponCode: null,
        prepaidGrouponPlatform: null,
        prepaidVoucherCode: null,
        prepaidVoucherPlatform: null,
        prepaidNote: null,
        prepaidAmount: null,
        prepaidVoucherFaceAmount: null,
        items: data.items,
        itemsCost: data.itemsCost,
        renewRecords: [],
        status: SpaceSessionStatus.active,
        saleOrderId: null,
        createdAt: new Date('2026-06-07T10:00:00.000Z'),
        updatedAt: new Date('2026-06-07T10:30:00.000Z'),
        space: {
          id: 7,
          name: 'A01',
          type: {
            name: '台球桌',
          },
        },
      }));

      const result = await service.addItemsToSession(
        user,
        9,
        {
          items: [
            {
              productId: 'prod_b',
              productName: '薯片',
              categoryName: '零食',
              salePrice: 12,
              profit: 5,
              quantity: 2,
            },
          ],
        },
        deps,
      );

      expect(transaction.$queryRaw).toHaveBeenCalled();
      const updatePayload = transaction.spaceSession.update.mock.calls[0][0];
      const mergedItems = parseSpaceSessionItems(updatePayload.data.items);
      expect(mergedItems).toHaveLength(2);
      expect(mergedItems.map((item) => item.productId)).toEqual([
        'prod_a',
        'prod_b',
      ]);
      expect(Number(updatePayload.data.itemsCost)).toBe(34);
      expect(result.items).toHaveLength(2);
      expect(result.itemsCost).toBe(34);
    });
  });
});
