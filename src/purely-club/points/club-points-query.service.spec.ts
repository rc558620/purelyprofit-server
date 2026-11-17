import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubPointsQueryService } from './club-points-query.service';

describe('ClubPointsQueryService', () => {
  let service: ClubPointsQueryService;

  const prismaService = {
    marketingCustomer: {
      findFirst: jest.fn(),
    },
    marketingPointsRecord: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    // 余额快照窗口走单条原生 SQL（窗口函数下推），由 $queryRaw 承担
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.$queryRaw.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPointsQueryService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<ClubPointsQueryService>(ClubPointsQueryService);
  });

  describe('findCustomerByStoreAndPhone', () => {
    it('优先按 clubUserId 命中本人档案，不依赖手机号', async () => {
      prismaService.marketingCustomer.findFirst.mockResolvedValueOnce({
        id: 98,
        points: 580,
      });

      await expect(
        service.findCustomerByStoreAndPhone(11, '13800138000', 201),
      ).resolves.toEqual({
        id: 98,
        points: 580,
      });
      // 锚点命中即收手，不会再退化到手机号匹配
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledTimes(
        1,
      );
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledWith({
        where: {
          storeId: 11,
          clubUserId: 201,
          deletedAt: null,
        },
        select: { id: true, points: true },
      });
    });

    it('锚点落空时按手机号认领无主档案（必须带 clubUserId: null 限定）', async () => {
      prismaService.marketingCustomer.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 99,
          points: 100,
        });

      await expect(
        service.findCustomerByStoreAndPhone(11, 'club_wechat:oOPENID123', 215),
      ).resolves.toEqual({
        id: 99,
        points: 100,
      });
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledTimes(
        2,
      );
      // 少了 clubUserId: null 限定，同门店里属于他人的同号档案会被当作自己的
      expect(
        prismaService.marketingCustomer.findFirst,
      ).toHaveBeenLastCalledWith({
        where: {
          storeId: 11,
          phone: 'club_wechat:oOPENID123',
          clubUserId: null,
          deletedAt: null,
        },
        select: { id: true, points: true },
      });
    });

    it('P1：未绑手机号用户按 clubUserId 认人，而非捞同门店任意 phone=null 的顾客', async () => {
      // 按查询条件返回，避免依赖调用顺序
      prismaService.marketingCustomer.findFirst.mockImplementation(
        (args: { where?: Record<string, unknown> }) => {
          if ('clubUserId' in (args?.where ?? {})) {
            return { id: 42, points: 300 };
          }
          return null;
        },
      );

      await expect(
        service.findCustomerByStoreAndPhone(11, 'club_wechat:oOPENID123', 215),
      ).resolves.toEqual({ id: 42, points: 300 });

      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledWith({
        where: { storeId: 11, clubUserId: 215, deletedAt: null },
        select: { id: true, points: true },
      });
    });

    it('P1：绝不使用 phone=null 兜底（否则会把别人的积分当自己的）', async () => {
      // 同门店存在一条 phone=null 的顾客档案（属于别人）
      prismaService.marketingCustomer.findFirst.mockImplementation(
        (args: { where?: Record<string, unknown> }) => {
          const where = args?.where ?? {};
          if ('clubUserId' in where) return null;
          if ('phone' in where && where.phone === null) {
            return { id: 999, points: 9999 };
          }
          return null;
        },
      );

      await expect(
        service.findCustomerByStoreAndPhone(11, 'club_wechat:oOPENID123', 215),
      ).resolves.toBeNull();

      // 任何一次查询都不允许出现 phone: null
      const calls = prismaService.marketingCustomer.findFirst.mock.calls;
      expect(calls).toHaveLength(2);
      expect(
        calls.some(([args]: [{ where?: Record<string, unknown> }]) => {
          const where = args?.where ?? {};
          return 'phone' in where && where.phone === null;
        }),
      ).toBe(false);
    });

    it('非微信登录用户精确查询无结果时按 clubUserId 定位后仍无结果则返回 null', async () => {
      prismaService.marketingCustomer.findFirst.mockResolvedValue(null);

      await expect(
        service.findCustomerByStoreAndPhone(11, '13800138000', 201),
      ).resolves.toBeNull();
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe('calculateSummary', () => {
    it('正负混合数据时正确汇总', async () => {
      // 第一次 aggregate 调用：获得积分
      prismaService.marketingPointsRecord.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 800 } })
        // 第二次 aggregate 调用：消耗积分
        .mockResolvedValueOnce({ _sum: { amount: -350 } });

      const result = await service.calculateSummary(11, 98);

      expect(result).toEqual({
        totalEarned: 800,
        totalRedeemed: 350,
      });

      // 验证两次 aggregate 调用的 where 条件
      expect(
        prismaService.marketingPointsRecord.aggregate,
      ).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            storeId: 11,
            customerId: 98,
            amount: { gt: 0 },
          }),
        }),
      );
      expect(
        prismaService.marketingPointsRecord.aggregate,
      ).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            storeId: 11,
            customerId: 98,
            amount: { lt: 0 },
          }),
        }),
      );
    });

    it('只有正向积分时 totalRedeemed 为 0', async () => {
      prismaService.marketingPointsRecord.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 500 } })
        .mockResolvedValueOnce({ _sum: { amount: null } });

      const result = await service.calculateSummary(11, 98);

      expect(result).toEqual({
        totalEarned: 500,
        totalRedeemed: 0,
      });
    });

    it('只有负向积分时 totalEarned 为 0', async () => {
      prismaService.marketingPointsRecord.aggregate
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: -200 } });

      const result = await service.calculateSummary(11, 98);

      expect(result).toEqual({
        totalEarned: 0,
        totalRedeemed: 200,
      });
    });

    it('空数据时汇总均为 0', async () => {
      prismaService.marketingPointsRecord.aggregate
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } });

      const result = await service.calculateSummary(11, 98);

      expect(result).toEqual({
        totalEarned: 0,
        totalRedeemed: 0,
      });
    });
  });

  describe('listPointsRecords', () => {
    it('返回积分明细，并额外返回余额快照窗口（DB 侧聚合标量）', async () => {
      const rows = [
        {
          id: 18,
          amount: 120,
          type: 'earn',
          description: '消费获得积分',
          createdAt: new Date('2024-11-20T10:30:00.000Z'),
        },
      ];

      prismaService.marketingPointsRecord.findMany.mockResolvedValue(rows);
      prismaService.marketingPointsRecord.count.mockResolvedValue(1);
      prismaService.$queryRaw.mockResolvedValue([
        { recordId: 18, cumulativeEffect: 120n, totalEffect: 120n },
      ]);

      const result = await service.listPointsRecords(11, 98, 'all');

      expect(result.items).toEqual(rows);
      expect(result.total).toBe(1);
      expect(result.balanceWindow).toEqual({
        totalEffect: 120,
        cumulativeEffectByRecordId: new Map([[18, 120]]),
      });
      // 分页只查一次；窗口求和不再整表拉回
      expect(
        prismaService.marketingPointsRecord.findMany,
      ).toHaveBeenCalledTimes(1);
      const rawCall = prismaService.$queryRaw.mock.calls[0] as unknown as [
        readonly string[],
        ...unknown[],
      ];
      const sqlText = rawCall[0].join('?');
      expect(sqlText).toContain('marketing_points_records');
      expect(sqlText).toContain('ROWS UNBOUNDED PRECEDING');
      expect(sqlText).toContain('ORDER BY p.created_at ASC, p.id ASC');
      // 门店 + 顾客双等值限定
      expect(rawCall[1]).toBe(11);
      expect(rawCall[2]).toBe(98);
      // 窗口起点 = 本页最旧一条的 createdAt
      expect(rawCall).toContainEqual(new Date('2024-11-20T10:30:00.000Z'));
    });

    it('按 earn 筛选时 where 条件包含 amount > 0', async () => {
      prismaService.marketingPointsRecord.findMany.mockResolvedValue([]);
      prismaService.marketingPointsRecord.count.mockResolvedValue(0);

      await service.listPointsRecords(11, 98, 'earn');

      const findManyCall =
        prismaService.marketingPointsRecord.findMany.mock.calls[0][0];
      expect(findManyCall.where.amount).toEqual({ gt: 0 });
    });

    it('按 redeem 筛选时 where 条件包含 amount < 0', async () => {
      prismaService.marketingPointsRecord.findMany.mockResolvedValue([]);
      prismaService.marketingPointsRecord.count.mockResolvedValue(0);

      await service.listPointsRecords(11, 98, 'redeem');

      const findManyCall =
        prismaService.marketingPointsRecord.findMany.mock.calls[0][0];
      expect(findManyCall.where.amount).toEqual({ lt: 0 });
    });

    it('透传 limit 与游标到查询条件', async () => {
      prismaService.marketingPointsRecord.findMany.mockResolvedValue([]);
      prismaService.marketingPointsRecord.count.mockResolvedValue(0);

      await service.listPointsRecords(11, 98, 'all', {
        limit: 20,
        cursor: {
          createdAt: '2024-11-20T10:30:00.000Z',
          id: 18,
        },
      });

      const findManyCall =
        prismaService.marketingPointsRecord.findMany.mock.calls[0][0];
      // 游标过滤：比上一页最后一条更早，或同刻但 id 更小
      expect(findManyCall.where.OR).toEqual([
        { createdAt: { lt: '2024-11-20T10:30:00.000Z' } },
        {
          createdAt: '2024-11-20T10:30:00.000Z',
          id: { lt: 18 },
        },
      ]);
      // 多取一行用于判定 hasMore，不影响本页实际返回条数
      expect(findManyCall.take).toBe(21);
      // 空结果时不额外查快照基准
      expect(
        prismaService.marketingPointsRecord.findMany,
      ).toHaveBeenCalledTimes(1);
    });

    it('withTotal=false 时跳过 count，hasMore 由多取一行判定', async () => {
      prismaService.marketingPointsRecord.findMany.mockResolvedValue(
        Array.from({ length: 21 }, (_, index) => ({
          id: index + 1,
          amount: 10,
          type: 'earn' as const,
          description: '消费获得积分',
          createdAt: new Date('2024-11-20T10:30:00.000Z'),
        })),
      );
      prismaService.marketingPointsRecord.count.mockResolvedValue(0);

      const result = await service.listPointsRecords(11, 98, 'all', {
        limit: 20,
        withTotal: false,
      });

      expect(prismaService.marketingPointsRecord.count).not.toHaveBeenCalled();
      expect(result.total).toBeNull();
      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(20);
    });

    it('P1：total 为符合筛选条件的总条数，不带游标条件', async () => {
      prismaService.marketingPointsRecord.findMany.mockResolvedValue([]);
      prismaService.marketingPointsRecord.count.mockResolvedValue(0);

      await service.listPointsRecords(11, 98, 'earn', {
        limit: 20,
        cursor: { createdAt: '2024-11-20T10:30:00.000Z', id: 18 },
      });

      // 带上游标条件会让第 2 页起 total 变成「剩余条数」，与 DTO 语义不符
      expect(prismaService.marketingPointsRecord.count).toHaveBeenCalledWith({
        where: { storeId: 11, customerId: 98, amount: { gt: 0 } },
      });
    });
  });
});
