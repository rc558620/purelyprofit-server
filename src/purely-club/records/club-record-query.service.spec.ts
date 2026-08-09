import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubRecordQueryService } from './club-record-query.service';

describe('ClubRecordQueryService', () => {
  let service: ClubRecordQueryService;

  const prismaService = {
    marketingCustomer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    marketingRecharge: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    marketingConsumption: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubRecordQueryService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<ClubRecordQueryService>(ClubRecordQueryService);
  });

  describe('findCustomerByStoreAndPhone', () => {
    it('按门店与手机号查询顾客余额档案', async () => {
      prismaService.marketingCustomer.findFirst.mockResolvedValue({
        id: 98,
        balance: 35000,
      });

      await expect(
        service.findCustomerByStoreAndPhone(11, '13800138000'),
      ).resolves.toEqual({
        id: 98,
        balance: 35000,
      });
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledWith({
        where: {
          storeId: 11,
          phone: '13800138000',
          deletedAt: null,
        },
        select: {
          id: true,
          balance: true,
        },
      });
    });

    it('精确查询无结果且回退到 findFirst 匹配 phone=null 的记录', async () => {
      prismaService.marketingCustomer.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 99,
          balance: 10000,
        });

      await expect(
        service.findCustomerByStoreAndPhone(11, 'club_wechat:oOPENID123'),
      ).resolves.toEqual({
        id: 99,
        balance: 10000,
      });
      // 第一次调用：精确匹配
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenNthCalledWith(
        1,
        {
          where: {
            storeId: 11,
            phone: 'club_wechat:oOPENID123',
            deletedAt: null,
          },
          select: {
            id: true,
            balance: true,
          },
        },
      );
      // 第二次调用：回退查询 phone=null
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenNthCalledWith(
        2,
        {
          where: {
            storeId: 11,
            deletedAt: null,
            phone: null,
          },
          select: {
            id: true,
            balance: true,
          },
        },
      );
    });

    it('非微信登录用户精确查询无结果时不回退', async () => {
      prismaService.marketingCustomer.findFirst.mockResolvedValue(null);

      await expect(
        service.findCustomerByStoreAndPhone(11, '13800138000'),
      ).resolves.toBeNull();
      // 仅调用一次（精确查询），无回退
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledTimes(
        1,
      );
    });

    it('精确查询和回退查询都无结果时返回 null', async () => {
      prismaService.marketingCustomer.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await expect(
        service.findCustomerByStoreAndPhone(11, 'club_wechat:oOPENID123'),
      ).resolves.toBeNull();
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe('listLedgerEntries', () => {
    it('聚合充值赠送消费流水并按时间倒序返回（不含退款）', async () => {
      prismaService.marketingRecharge.findMany.mockResolvedValue([
        {
          id: 18,
          amount: 50000,
          giftAmount: 8000,
          totalAmount: 58000,
          type: 'recharge',
          note: null,
          createdAt: new Date('2024-11-20T10:30:00.000Z'),
        },
        {
          id: 16,
          amount: 0,
          giftAmount: 5000,
          totalAmount: 5000,
          type: 'gift',
          note: '黄金会员生日礼品券',
          createdAt: new Date('2024-10-01T00:00:00.000Z'),
        },
      ]);
      prismaService.marketingConsumption.findMany.mockResolvedValue([
        {
          id: 31,
          amount: 19900,
          balancePaid: 19900,
          itemsSummary: '购买经典养护套餐',
          createdAt: new Date('2024-11-18T14:20:00.000Z'),
        },
      ]);

      prismaService.marketingRecharge.count.mockResolvedValue(2);
      prismaService.marketingConsumption.count.mockResolvedValue(1);

      await expect(service.listLedgerEntries(11, 98)).resolves.toEqual({
        items: [
          {
            id: 'recharge-18',
            type: 'recharge',
            amountFen: 50000,
            balanceEffectFen: 58000,
            description: '充值 ¥500 赠 ¥80',
            createdAt: new Date('2024-11-20T10:30:00.000Z'),
          },
          {
            id: 'consume-31',
            type: 'consume',
            amountFen: -19900,
            balanceEffectFen: -19900,
            description: '购买经典养护套餐',
            createdAt: new Date('2024-11-18T14:20:00.000Z'),
          },
          {
            id: 'bonus-16',
            type: 'bonus',
            amountFen: 5000,
            // BUG-6 修复后：gift 类型 balanceEffectFen 仅计入 giftAmount
            balanceEffectFen: 5000,
            description: '黄金会员生日礼品券',
            createdAt: new Date('2024-10-01T00:00:00.000Z'),
          },
        ],
        total: 3,
      });
    });

    it('过滤无效赠送与无效消费记录', async () => {
      prismaService.marketingRecharge.findMany.mockResolvedValue([
        {
          id: 16,
          amount: 0,
          giftAmount: 0,
          totalAmount: 0,
          type: 'gift',
          note: null,
          createdAt: new Date('2024-10-01T00:00:00.000Z'),
        },
      ]);
      prismaService.marketingConsumption.findMany.mockResolvedValue([
        {
          id: 31,
          amount: 0,
          balancePaid: 0,
          itemsSummary: null,
          createdAt: new Date('2024-11-18T14:20:00.000Z'),
        },
      ]);

      prismaService.marketingRecharge.count.mockResolvedValue(1);
      prismaService.marketingConsumption.count.mockResolvedValue(1);

      await expect(service.listLedgerEntries(11, 98)).resolves.toEqual({
        items: [],
        total: 2,
      });
    });

    it('gift 类型 amount>0 且 giftAmount>0 时 balanceEffectFen 仅计入 giftAmount', async () => {
      // 边界场景：历史脏数据中 gift 类型同时有 amount 和 giftAmount
      prismaService.marketingRecharge.findMany.mockResolvedValue([
        {
          id: 20,
          amount: 3000,
          giftAmount: 5000,
          totalAmount: 8000,
          type: 'gift',
          note: null,
          createdAt: new Date('2024-12-01T00:00:00.000Z'),
        },
      ]);
      prismaService.marketingConsumption.findMany.mockResolvedValue([]);
      prismaService.marketingRecharge.count.mockResolvedValue(1);
      prismaService.marketingConsumption.count.mockResolvedValue(0);

      const result = await service.listLedgerEntries(11, 98);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: 'bonus-20',
        type: 'bonus',
        amountFen: 5000, // bonusAmountFen = giftAmount（>0 时取 giftAmount）
        balanceEffectFen: 5000, // 修复后仅计入 giftAmount，不重复计入 amount
        description: '赠送 ¥50',
        createdAt: new Date('2024-12-01T00:00:00.000Z'),
      });
    });

    it('gift 类型 amount>0 且 giftAmount=0 时回退取 amount 作为 bonusAmountFen', async () => {
      // 边界场景：giftAmount 为 0 但 amount 有值的历史脏数据
      prismaService.marketingRecharge.findMany.mockResolvedValue([
        {
          id: 21,
          amount: 3000,
          giftAmount: 0,
          totalAmount: 3000,
          type: 'gift',
          note: '系统补赠',
          createdAt: new Date('2024-12-01T00:00:00.000Z'),
        },
      ]);
      prismaService.marketingConsumption.findMany.mockResolvedValue([]);
      prismaService.marketingRecharge.count.mockResolvedValue(1);
      prismaService.marketingConsumption.count.mockResolvedValue(0);

      const result = await service.listLedgerEntries(11, 98);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: 'bonus-21',
        type: 'bonus',
        amountFen: 3000, // bonusAmountFen 回退到 amount
        balanceEffectFen: 3000, // balanceEffectFen 也取 amount
        description: '系统补赠',
        createdAt: new Date('2024-12-01T00:00:00.000Z'),
      });
    });

    it('使用游标分页时传入 cursor 过滤条件', async () => {
      prismaService.marketingRecharge.findMany.mockResolvedValue([]);
      prismaService.marketingConsumption.findMany.mockResolvedValue([]);
      prismaService.marketingRecharge.count.mockResolvedValue(0);
      prismaService.marketingConsumption.count.mockResolvedValue(0);

      const cursor = {
        createdAt: new Date('2024-11-18T14:20:00.000Z'),
        id: 'consume-31',
      };

      await service.listLedgerEntries(11, 98, { limit: 50, cursor });

      // 验证 findMany 调用中包含了 cursor 过滤条件
      const rechargeCall =
        prismaService.marketingRecharge.findMany.mock.calls[0][0];
      expect(rechargeCall.where.OR).toBeDefined();
      expect(rechargeCall.where.OR).toEqual([
        { createdAt: { lt: cursor.createdAt } },
        {
          createdAt: cursor.createdAt,
          id: { lt: 31 },
        },
      ]);

      const consumptionCall =
        prismaService.marketingConsumption.findMany.mock.calls[0][0];
      expect(consumptionCall.where.OR).toBeDefined();
    });

    it('无游标时不添加 cursor 过滤条件', async () => {
      prismaService.marketingRecharge.findMany.mockResolvedValue([]);
      prismaService.marketingConsumption.findMany.mockResolvedValue([]);
      prismaService.marketingRecharge.count.mockResolvedValue(0);
      prismaService.marketingConsumption.count.mockResolvedValue(0);

      await service.listLedgerEntries(11, 98);

      const rechargeCall =
        prismaService.marketingRecharge.findMany.mock.calls[0][0];
      expect(rechargeCall.where.OR).toBeUndefined();
    });

    it('recharge 筛选时只查充值表且不查消费表', async () => {
      prismaService.marketingRecharge.findMany.mockResolvedValue([
        {
          id: 18,
          amount: 50000,
          giftAmount: 8000,
          totalAmount: 58000,
          type: 'recharge',
          note: null,
          createdAt: new Date('2024-11-20T10:30:00.000Z'),
        },
      ]);
      prismaService.marketingConsumption.findMany.mockResolvedValue([]);
      prismaService.marketingRecharge.count.mockResolvedValue(1);
      prismaService.marketingConsumption.count.mockResolvedValue(0);

      const result = await service.listLedgerEntries(11, 98, {
        filterType: 'recharge',
      });

      expect(
        prismaService.marketingConsumption.findMany,
      ).not.toHaveBeenCalled();
      expect(prismaService.marketingConsumption.count).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      // 充值表类型过滤：排除退款
      const rechargeCall =
        prismaService.marketingRecharge.findMany.mock.calls[0][0];
      expect(rechargeCall.where.type).toEqual({ not: 'refund' });
    });

    it('consume 筛选时充值表仅查退款且消费表正常查询', async () => {
      prismaService.marketingRecharge.findMany.mockResolvedValue([
        {
          id: 22,
          amount: 5000,
          giftAmount: 0,
          totalAmount: 5000,
          type: 'refund',
          note: null,
          createdAt: new Date('2024-11-22T10:30:00.000Z'),
        },
      ]);
      prismaService.marketingConsumption.findMany.mockResolvedValue([]);
      prismaService.marketingRecharge.count.mockResolvedValue(1);
      prismaService.marketingConsumption.count.mockResolvedValue(0);

      const result = await service.listLedgerEntries(11, 98, {
        filterType: 'consume',
      });

      expect(prismaService.marketingConsumption.findMany).toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('refund-22');
      // 充值表类型过滤：仅退款
      const rechargeCall =
        prismaService.marketingRecharge.findMany.mock.calls[0][0];
      expect(rechargeCall.where.type).toEqual('refund');
    });

    it('消费记录 balancePaid=0 时回退使用 amount', async () => {
      prismaService.marketingRecharge.findMany.mockResolvedValue([]);
      prismaService.marketingConsumption.findMany.mockResolvedValue([
        {
          id: 40,
          amount: 8800,
          balancePaid: 0,
          itemsSummary: '现金消费',
          createdAt: new Date('2024-11-18T14:20:00.000Z'),
        },
      ]);
      prismaService.marketingRecharge.count.mockResolvedValue(0);
      prismaService.marketingConsumption.count.mockResolvedValue(1);

      const result = await service.listLedgerEntries(11, 98);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].amountFen).toBe(-8800);
      expect(result.items[0].balanceEffectFen).toBe(-8800);
    });

    it('消费记录 balancePaid 和 amount 都为 0 时过滤掉', async () => {
      prismaService.marketingRecharge.findMany.mockResolvedValue([]);
      prismaService.marketingConsumption.findMany.mockResolvedValue([
        {
          id: 41,
          amount: 0,
          balancePaid: 0,
          itemsSummary: null,
          createdAt: new Date('2024-11-18T14:20:00.000Z'),
        },
      ]);
      prismaService.marketingRecharge.count.mockResolvedValue(0);
      prismaService.marketingConsumption.count.mockResolvedValue(1);

      const result = await service.listLedgerEntries(11, 98);
      expect(result.items).toHaveLength(0);
    });
  });
});
