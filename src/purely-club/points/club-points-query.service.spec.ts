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
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPointsQueryService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<ClubPointsQueryService>(ClubPointsQueryService);
  });

  describe('findCustomerByStoreAndPhone', () => {
    it('按门店与手机号查询顾客积分余额', async () => {
      prismaService.marketingCustomer.findFirst.mockResolvedValue({
        id: 98,
        points: 580,
      });

      await expect(
        service.findCustomerByStoreAndPhone(11, '13800138000'),
      ).resolves.toEqual({
        id: 98,
        points: 580,
      });
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledWith({
        where: {
          storeId: 11,
          phone: '13800138000',
          deletedAt: null,
        },
        select: { id: true, points: true },
      });
    });

    it('精确查询无结果且回退到匹配 phone=null 的记录', async () => {
      prismaService.marketingCustomer.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 99,
          points: 100,
        });

      await expect(
        service.findCustomerByStoreAndPhone(11, 'club_wechat:oOPENID123'),
      ).resolves.toEqual({
        id: 99,
        points: 100,
      });
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledTimes(
        2,
      );
    });

    it('非微信登录用户精确查询无结果时不回退', async () => {
      prismaService.marketingCustomer.findFirst.mockResolvedValue(null);

      await expect(
        service.findCustomerByStoreAndPhone(11, '13800138000'),
      ).resolves.toBeNull();
      expect(prismaService.marketingCustomer.findFirst).toHaveBeenCalledTimes(
        1,
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
    it('返回指定顾客的积分明细列表与 baseEffect 默认值', async () => {
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

      const result = await service.listPointsRecords(11, 98, 'all');

      expect(result.items).toEqual(rows);
      expect(result.total).toBe(1);
      expect(result.baseEffect).toBe(0);
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

      const result = await service.listPointsRecords(11, 98, 'all', {
        limit: 20,
        cursor: {
          createdAt: '2024-11-20T10:30:00.000Z',
          id: 18,
          totalEffect: 500,
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
      expect(findManyCall.take).toBe(20);
      // baseEffect 取自游标的累计变动量
      expect(result.baseEffect).toBe(500);
    });
  });
});
