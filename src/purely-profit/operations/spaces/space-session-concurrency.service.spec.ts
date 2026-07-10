import { Test, TestingModule } from '@nestjs/testing';
import { SpaceBillingMode, SpaceSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import * as inventoryStockQuery from '../../goods/inventory/inventory-stock.query';
import { SpaceSessionRenewService } from './space-session-renew.service';
import { RedisLockService } from '../../../redis/redis-lock.service';
import { SpaceSessionWriteService } from './space-session-write.service';
import { mapSessionItemRows } from './space-sessions.mapper';
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
      /// Step 8.1: renew records 表
      spaceSessionRenewRecord: {
        create: jest.fn(),
      },
    };

    const prismaService = {
      spaceSession: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const commerceAccessService = {
      ensureCanAccessStore: jest.fn(),
    };

    const redisLockService = {
      acquireLock: jest.fn(),
      releaseLock: jest.fn(),
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      prismaService.$transaction.mockImplementation((callback) =>
        Promise.resolve(callback(transaction)),
      );
      commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
      redisLockService.acquireLock.mockResolvedValue({
        resource: 'space:session:renew:9',
        token: 'test-token',
        key: 'distributed-lock:space:session:renew:9',
      });
      redisLockService.releaseLock.mockResolvedValue(undefined);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SpaceSessionRenewService,
          { provide: PrismaService, useValue: prismaService },
          { provide: CommerceAccessService, useValue: commerceAccessService },
          { provide: RedisLockService, useValue: redisLockService },
        ],
      }).compile();

      service = module.get<SpaceSessionRenewService>(SpaceSessionRenewService);
    });

    it('续费时应基于事务内最新会话合并倒计时与续费记录', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_717_000_000_000);
      jest.spyOn(Math, 'random').mockReturnValue(0.123456);

      prismaService.spaceSession.findFirst.mockResolvedValue({
        id: 9,
        storeId: 18,
      });
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
        hourlyRate: 6800, // DB 存储为分（68元）
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
        sessionItems: [],
        itemsCost: 0, // DB 存储为分（0元）
        sessionRenewRecords: [
          {
            id: 1,
            sessionId: 9,
            recordId: 'rn_existing',
            amount: 3000, // DB 存储为分（30元）
            addedMinutes: 26,
            paymentMethod: 'cash',
            grouponCode: null,
            grouponPlatform: null,
            voucherFaceAmount: null,
            note: null,
            renewedAt: 1_716_000_000_000,
            createdAt: new Date('2026-06-07T10:26:00.000Z'),
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
        hourlyRate: 6800, // DB 存储为分（68元）
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
        sessionItems: [],
        itemsCost: 0, // DB 存储为分（0元）
        // Simulate include: sessionRenewRecords returning existing + newly created
        sessionRenewRecords: [
          {
            id: 1,
            sessionId: 9,
            recordId: 'rn_existing',
            amount: 3000, // DB 存储为分（30元）
            addedMinutes: 26,
            paymentMethod: 'cash',
            grouponCode: null,
            grouponPlatform: null,
            voucherFaceAmount: null,
            note: null,
            renewedAt: 1_716_000_000_000,
            createdAt: new Date('2026-06-07T10:26:00.000Z'),
          },
          {
            id: 2,
            sessionId: 9,
            recordId: expect.any(String),
            amount: 3000, // DB 存储为分（30元）
            addedMinutes: 26,
            paymentMethod: 'cash',
            grouponCode: null,
            grouponPlatform: null,
            voucherFaceAmount: null,
            note: null,
            renewedAt: expect.any(Number),
            createdAt: expect.any(Date),
          },
        ],
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
      // Verify the service correctly maps sessionRenewRecords rows back to business records
      expect(result.renewRecord.amount).toBe(30); // 3000分 = 30元
      expect(result.renewRecord.addedMinutes).toBe(26);
      // Verify that spaceSessionRenewRecord.create was called in Step 8.1 logic
      expect(transaction.spaceSessionRenewRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: 9,
            amount: 3000, // DB 存储为分（30元）
            addedMinutes: 26,
            paymentMethod: 'cash',
          }),
        }),
      );
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
      /// Step 8.1: space_session_items / renew_records 表
      spaceSessionItem: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      spaceSessionRenewRecord: {
        create: jest.fn(),
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
      findOperatorStaffIdForStore: jest.fn(),
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      prismaService.$transaction.mockImplementation((callback) =>
        Promise.resolve(callback(transaction)),
      );
      deps.ensureCanAccessStore.mockResolvedValue(undefined);
      deps.findOperatorStaffIdForStore.mockResolvedValue(8);

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
        hourlyRate: 6800, // DB 存储为分（68元）
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
        sessionItems: [
          {
            id: 1,
            sessionId: 9,
            productId: 'prod_a',
            productName: '可乐',
            categoryName: '饮品',
            salePrice: 1000, // DB 存储为分（10元）
            profit: 400, // DB 存储为分（4元）
            quantity: 1,
            sortOrder: 0,
            createdAt: new Date('2026-06-07T10:00:00.000Z'),
          },
        ],
        itemsCost: 1000, // DB 存储为分（10元）
        sessionRenewRecords: [],
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
        hourlyRate: 6800, // DB 存储为分（68元）
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
        // Simulate include: sessionItems returning existing + newly created items
        sessionItems: [
          {
            id: 1,
            sessionId: 9,
            productId: 'prod_a',
            productName: '可乐',
            categoryName: '饮品',
            salePrice: 1000, // DB 存储为分（10元）
            profit: 400, // DB 存储为分（4元）
            quantity: 1,
            sortOrder: 0,
            createdAt: new Date('2026-06-07T10:00:00.000Z'),
          },
          {
            id: 2,
            sessionId: 9,
            productId: 'prod_b',
            productName: '薯片',
            categoryName: '零食',
            salePrice: 1200, // DB 存储为分（12元）
            profit: 500, // DB 存储为分（5元）
            quantity: 2,
            sortOrder: 1,
            createdAt: new Date('2026-06-07T10:30:00.000Z'),
          },
        ],
        itemsCost: data.itemsCost,
        sessionRenewRecords: [],
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
      // After Step 8.1: items are stored in separate table, so updatePayload.data
      // no longer contains items JSON; verify itemsCost is computed correctly
      // itemsCost 在 DB 中存储为分：10*1 + 12*2 = 34元 → Money.fromInputYuan(34).toDbCents() = 3400分
      expect(Number(updatePayload.data.itemsCost)).toBe(3400);
      expect(result.items).toHaveLength(2);
      expect(result.itemsCost).toBe(34); // toSpaceSessionResponse 将 3400分 转回 34元
      // Also verify spaceSessionItem.createMany was called with merged items
      const itemCreateCalls =
        transaction.spaceSessionItem?.createMany?.mock?.calls ?? [];
      if (itemCreateCalls.length > 0) {
        const createdItems = itemCreateCalls[0][0].data as Array<{
          productId: string;
        }>;
        const mergedItems = mapSessionItemRows(
          createdItems.map((item, idx) => ({
            ...item,
            id: idx + 1,
            sessionId: 9,
            sortOrder: idx,
            createdAt: new Date(),
          })) as any[],
        );
        expect(mergedItems).toHaveLength(2);
        expect(mergedItems.map((item) => item.productId)).toEqual([
          'prod_a',
          'prod_b',
        ]);
      }
    });

    it('server 库存同步模式下应按 sale 类型扣减库存', async () => {
      const applyInventoryDeductionsInTransactionSpy = jest
        .spyOn(inventoryStockQuery, 'applyInventoryDeductionsInTransaction')
        .mockResolvedValue(undefined);

      prismaService.spaceSession.findUnique.mockResolvedValue({
        id: 10,
        storeId: 18,
      });
      transaction.spaceSession.findUnique.mockResolvedValue({
        id: 10,
        storeId: 18,
        spaceId: 7,
        reservationId: null,
        guestName: '李四',
        guestPhone: '13800138001',
        guestCount: 2,
        startTime: new Date('2026-06-07T10:00:00.000Z'),
        endTime: null,
        billingMode: SpaceBillingMode.mixed,
        hourlyRate: 6800,
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
        sessionItems: [],
        itemsCost: 0,
        sessionRenewRecords: [],
        status: SpaceSessionStatus.active,
        saleOrderId: null,
        createdAt: new Date('2026-06-07T10:00:00.000Z'),
        updatedAt: new Date('2026-06-07T10:00:00.000Z'),
        space: {
          id: 7,
          name: 'A01',
          type: {
            name: '台球桌',
          },
        },
      });
      transaction.spaceSession.update.mockImplementation(({ data }) => ({
        id: 10,
        storeId: 18,
        spaceId: 7,
        reservationId: null,
        guestName: '李四',
        guestPhone: '13800138001',
        guestCount: 2,
        startTime: new Date('2026-06-07T10:00:00.000Z'),
        endTime: null,
        billingMode: SpaceBillingMode.mixed,
        hourlyRate: 6800,
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
        sessionItems: [
          {
            id: 3,
            sessionId: 10,
            productId: '5',
            productName: '利润测试3',
            categoryName: '房东说',
            salePrice: 71200,
            profit: 4600,
            quantity: 1,
            sortOrder: 0,
            createdAt: new Date('2026-06-07T10:05:00.000Z'),
          },
        ],
        itemsCost: data.itemsCost,
        sessionRenewRecords: [],
        status: SpaceSessionStatus.active,
        saleOrderId: null,
        createdAt: new Date('2026-06-07T10:00:00.000Z'),
        updatedAt: new Date('2026-06-07T10:05:00.000Z'),
        space: {
          id: 7,
          name: 'A01',
          type: {
            name: '台球桌',
          },
        },
      }));

      await service.addItemsToSession(
        user,
        10,
        {
          items: [
            {
              productId: '5',
              productName: '利润测试3',
              categoryName: '房东说',
              salePrice: 712,
              profit: 46,
              quantity: 1,
            },
          ],
          inventorySyncMode: 'server',
        },
        deps,
      );

      expect(deps.findOperatorStaffIdForStore).toHaveBeenCalledWith(user, 18);
      expect(applyInventoryDeductionsInTransactionSpy).toHaveBeenCalledWith(
        transaction,
        [
          {
            productId: 5,
            quantity: 1,
            productName: '利润测试3',
          },
        ],
        18,
        8,
        'sale',
        '空间管理追加点单',
      );
    });
  });
});
