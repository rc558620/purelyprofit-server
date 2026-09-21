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
        service.findCustomerByStoreAndPhone(11, '13800138000', 201),
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

    it('精确查询无结果时按 clubUserId 稳定键定位', async () => {
      prismaService.marketingCustomer.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 99,
          balance: 10000,
        });

      await expect(
        service.findCustomerByStoreAndPhone(11, 'club_wechat:oOPENID123', 215),
      ).resolves.toEqual({
        id: 99,
        balance: 10000,
      });
      // 第一次调用：phone 精确匹配
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
      // 第二次调用：clubUserId 稳定键
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenNthCalledWith(
        2,
        {
          where: {
            storeId: 11,
            clubUserId: 215,
            deletedAt: null,
          },
          select: {
            id: true,
            balance: true,
          },
        },
      );
    });

    it('非微信登录用户精确查询无结果时按 clubUserId 定位，不做 phone=null 兜底', async () => {
      // 同门店存在一条 phone=null 的顾客档案（属于别人），绝不能被命中
      prismaService.marketingCustomer.findFirst.mockImplementation(
        (args: { where?: Record<string, unknown> }) => {
          const where = args?.where ?? {};
          if ('clubUserId' in where) return null;
          if ('phone' in where && where.phone === null) {
            return { id: 999, balance: 99999 };
          }
          return null;
        },
      );

      await expect(
        service.findCustomerByStoreAndPhone(11, '13800138000', 201),
      ).resolves.toBeNull();

      // 只发了两条精确查询，从未出现 phone: null
      const calls = prismaService.marketingCustomer.findFirst.mock.calls;
      expect(calls).toHaveLength(2);
      expect(
        calls.some(([args]: [{ where?: Record<string, unknown> }]) => {
          const where = args?.where ?? {};
          return 'phone' in where && where.phone === null;
        }),
      ).toBe(false);
    });

    it('精确查询与 clubUserId 定位都无结果时返回 null', async () => {
      prismaService.marketingCustomer.findFirst.mockResolvedValue(null);

      await expect(
        service.findCustomerByStoreAndPhone(11, 'club_wechat:oOPENID123', 215),
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

      const result = await service.listLedgerEntries(11, 98);

      expect(result.items).toEqual([
        {
          id: 'recharge-18',
          type: 'recharge',
          amountFen: 50000,
          balanceEffectFen: 58000,
          // 描述内金额同样统一保留 2 位小数
          description: '充值 ¥500.00 赠 ¥80.00',
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
      ]);
      expect(result.total).toBe(3);
      // 余额快照基准：全量流水按时间升序，供 view 层反推每笔流水后的真实余额
      expect(result.balanceEntries.map((entry) => entry.id)).toEqual([
        'bonus-16',
        'consume-31',
        'recharge-18',
      ]);
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
        // 无可展示条目时不触发余额快照窗口查询
        balanceEntries: [],
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
        description: '赠送 ¥50.00',
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

    it('recharge 筛选时消费表不参与过滤分页（仅余额快照窗口查询）', async () => {
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

      // 分页过滤不查消费表（count 只在过滤分页阶段调用）
      expect(prismaService.marketingConsumption.count).not.toHaveBeenCalled();
      // 消费表仅在余额快照窗口查询中被访问：不带 Tab 过滤，按时间升序
      expect(prismaService.marketingConsumption.findMany).toHaveBeenCalledTimes(
        1,
      );
      const snapshotConsumptionCall =
        prismaService.marketingConsumption.findMany.mock.calls[0][0];
      expect(snapshotConsumptionCall.orderBy).toEqual([
        { createdAt: 'asc' },
        { id: 'asc' },
      ]);
      expect(snapshotConsumptionCall.where.balancePaid).toEqual({ gt: 0 });
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

    it('消费表查询限定 balancePaid > 0：现金/空间结算消费不进储值账户流水', async () => {
      prismaService.marketingRecharge.findMany.mockResolvedValue([]);
      // 即便 mock 绕过 SQL 过滤返回 balancePaid=0 的行，也不得进入流水
      prismaService.marketingConsumption.findMany.mockResolvedValue([
        {
          id: 40,
          amount: 8800,
          balancePaid: 0,
          itemsSummary: '台位费（680小时3分钟）、预付款',
          createdAt: new Date('2024-11-18T14:20:00.000Z'),
        },
      ]);
      prismaService.marketingRecharge.count.mockResolvedValue(0);
      prismaService.marketingConsumption.count.mockResolvedValue(1);

      const result = await service.listLedgerEntries(11, 98);

      // 查询层拦截：过滤分页与总数统计都限定 balancePaid > 0
      const consumptionCall =
        prismaService.marketingConsumption.findMany.mock.calls[0][0];
      expect(consumptionCall.where.balancePaid).toEqual({ gt: 0 });
      expect(prismaService.marketingConsumption.count).toHaveBeenCalledWith({
        where: { storeId: 11, customerId: 98, balancePaid: { gt: 0 } },
      });
      expect(result.items).toHaveLength(0);
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
      expect(result.balanceEntries).toHaveLength(0);
    });
  });
});
