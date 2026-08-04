import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingTableQueryService } from './scan-ordering-table-query.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

describe('ScanOrderingTableQueryService.listTables', () => {
  let service: ScanOrderingTableQueryService;

  const user = { id: 1, role: 'store_owner' } as AuthenticatedUser;

  const prisma = {
    scanOrderingTable: { findMany: jest.fn() },
  };
  const commerceAccess = { resolveSingleStoreId: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    commerceAccess.resolveSingleStoreId.mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingTableQueryService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommerceAccessService, useValue: commerceAccess },
      ],
    }).compile();
    service = module.get(ScanOrderingTableQueryService);
  });

  describe('桌台订单口径矩阵', () => {
    type MatrixOrderStatus =
      | 'pending_payment'
      | 'pending_acceptance'
      | 'preparing'
      | 'served'
      | 'refunding'
      | 'rejected'
      | 'cancelled'
      | 'completed';

    const matrixCases: Array<{
      name: string;
      statuses: MatrixOrderStatus[];
      visibleCount: number;
      blockingCount: number;
      guestCount: number;
      canClear: boolean;
    }> = [
      {
        name: '双账号待接单与制作中',
        statuses: [
          'pending_acceptance',
          'preparing',
          'pending_acceptance',
          'preparing',
        ],
        visibleCount: 4,
        blockingCount: 4,
        guestCount: 10,
        canClear: false,
      },
      {
        name: '双账号全部已出餐',
        statuses: ['served', 'served', 'served', 'served'],
        visibleCount: 4,
        blockingCount: 0,
        guestCount: 10,
        canClear: true,
      },
      {
        name: '退款与已出餐混合',
        statuses: ['rejected', 'served', 'refunding', 'served'],
        visibleCount: 2,
        blockingCount: 0,
        guestCount: 5,
        canClear: true,
      },
      {
        name: '退款与未履约混合',
        statuses: ['rejected', 'pending_acceptance', 'refunding', 'preparing'],
        visibleCount: 2,
        blockingCount: 2,
        guestCount: 5,
        canClear: false,
      },
      {
        name: '取消完成与待支付混合',
        statuses: ['cancelled', 'completed', 'pending_payment', 'served'],
        visibleCount: 2,
        blockingCount: 1,
        guestCount: 6,
        canClear: false,
      },
    ];

    it.each(matrixCases)('$name 的桌台订单口径一致', async (testCase) => {
      const now = new Date();
      const orders = testCase.statuses
        .map((status, index) => ({
          id: index + 1,
          orderNo: `M${index + 1}`,
          status,
          paymentStatus: status === 'rejected' ? 'refunded' : 'paid',
          fulfillmentStatus: status === 'served' ? 'served' : 'pending',
          guestCount: index < 2 ? 2 : 3,
          payableAmount: 100,
          createdAt: now,
        }))
        .filter((order) =>
          [
            'pending_payment',
            'pending_acceptance',
            'preparing',
            'served',
          ].includes(order.status),
        );
      prisma.scanOrderingTable.findMany.mockResolvedValue([
        {
          id: 10,
          tableCode: 'A01',
          name: 'A01',
          status: 'empty',
          areaId: null,
          typeId: null,
          area: null,
          type: null,
          sessions: [
            {
              id: 301,
              createdAt: now,
              expiresAt: new Date(now.getTime() + 60_000),
              guestCount: 1,
              status: 'active',
              orders: orders.slice(0, 2),
            },
            {
              id: 302,
              createdAt: now,
              expiresAt: new Date(now.getTime() + 60_000),
              guestCount: 2,
              status: 'active',
              orders: orders.slice(2),
            },
            {
              id: 303,
              createdAt: now,
              expiresAt: now,
              guestCount: 9,
              status: 'left',
              orders: [],
            },
          ],
        },
      ]);

      const [table] = await service.listTables(user);

      expect(table.activeOrderCount).toBe(testCase.visibleCount);
      expect(table.activeOrders).toHaveLength(testCase.visibleCount);
      expect(table.clearability.blockingOrderCount).toBe(
        testCase.blockingCount,
      );
      expect(table.clearability.canClear).toBe(testCase.canClear);
      expect(table.guestCount).toBe(testCase.guestCount);
    });

    it('聚合本轮 active 与 left 会话的履约订单，但人数只累计未过期 active 会话', async () => {
      const now = new Date();
      prisma.scanOrderingTable.findMany.mockResolvedValue([
        {
          id: 10,
          tableCode: 'A01',
          name: 'A01',
          status: 'empty',
          areaId: null,
          typeId: null,
          area: null,
          type: null,
          sessions: [
            {
              id: 201,
              createdAt: now,
              expiresAt: new Date(now.getTime() + 60_000),
              guestCount: 1,
              status: 'active',
              orders: [
                {
                  id: 1,
                  orderNo: 'A1',
                  status: 'pending_acceptance',
                  paymentStatus: 'paid',
                  fulfillmentStatus: 'pending',
                  guestCount: 1,
                  payableAmount: 100,
                  createdAt: now,
                },
              ],
            },
            {
              id: 202,
              createdAt: now,
              expiresAt: new Date(now.getTime() - 60_000),
              guestCount: 4,
              status: 'left',
              orders: [
                {
                  id: 2,
                  orderNo: 'A2',
                  status: 'served',
                  paymentStatus: 'paid',
                  fulfillmentStatus: 'served',
                  guestCount: 1,
                  payableAmount: 200,
                  createdAt: now,
                },
                {
                  id: 3,
                  orderNo: 'B1',
                  status: 'preparing',
                  paymentStatus: 'paid',
                  fulfillmentStatus: 'preparing',
                  guestCount: 4,
                  payableAmount: 300,
                  createdAt: now,
                },
              ],
            },
          ],
        },
      ]);

      const [table] = await service.listTables(user);

      expect(table.activeOrderCount).toBe(table.activeOrders.length);
      expect(table.activeOrders.map((order) => order.id)).toEqual([1, 2, 3]);
      expect(table.guestCount).toBe(6);
      expect(table.clearability).toMatchObject({
        canClear: false,
        blockingOrderCount: 2,
      });
    });

    it('没有有效 active 会话时不让历史 left 会话重新占用空桌', async () => {
      const now = new Date();
      prisma.scanOrderingTable.findMany.mockResolvedValue([
        {
          id: 10,
          tableCode: 'A01',
          name: 'A01',
          status: 'empty',
          areaId: null,
          typeId: null,
          area: null,
          type: null,
          sessions: [
            {
              id: 202,
              createdAt: now,
              expiresAt: now,
              guestCount: 4,
              status: 'left',
              orders: [
                {
                  id: 2,
                  orderNo: 'A2',
                  status: 'pending_acceptance',
                  paymentStatus: 'paid',
                  fulfillmentStatus: 'pending',
                  payableAmount: 100,
                  createdAt: now,
                },
              ],
            },
          ],
        },
      ]);

      const [table] = await service.listTables(user);

      expect(table.status).toBe('empty');
      expect(table.activeOrderCount).toBe(0);
      expect(table.activeOrders).toHaveLength(0);
      expect(table.clearability).toMatchObject({
        canClear: false,
        blockingOrderCount: 0,
      });
    });
  });
});
