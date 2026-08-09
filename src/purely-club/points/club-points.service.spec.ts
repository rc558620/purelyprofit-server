import { Test, TestingModule } from '@nestjs/testing';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubPointsQueryService } from './club-points-query.service';
import { ClubPointsService } from './club-points.service';

describe('ClubPointsService', () => {
  let service: ClubPointsService;

  const clubPointsQueryService = {
    findCustomerByStoreAndPhone: jest.fn(),
    listPointsRecords: jest.fn(),
    calculateSummary: jest.fn(),
  };

  const currentContext: ClubCurrentContext = {
    user: {
      id: 201,
      email: 'club_phone_13800138000@purelyprofit.local',
      phone: '13800138000',
      name: '俱乐部用户',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      lastActiveAt: null,
      accountScope: 'purely_club',
      currentMembership: null,
    },
    store: {
      id: 11,
      name: 'purelyClub · 望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
      businessMode: 'general' as const,
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPointsService,
        {
          provide: ClubPointsQueryService,
          useValue: clubPointsQueryService,
        },
      ],
    }).compile();

    service = module.get<ClubPointsService>(ClubPointsService);
  });

  describe('listRecords', () => {
    it('无营销顾客档案时返回空列表和零值 summary', async () => {
      clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
        null,
      );

      const result = await service.listRecords(currentContext, {});

      expect(result).toEqual({
        items: [],
        total: 0,
        nextCursor: null,
        summary: { totalEarned: 0, totalRedeemed: 0 },
      });
      expect(clubPointsQueryService.listPointsRecords).not.toHaveBeenCalled();
      expect(clubPointsQueryService.calculateSummary).not.toHaveBeenCalled();
    });

    it('有顾客时返回积分明细和 summary', async () => {
      const customer = { id: 98, points: 580 };
      const rows = [
        {
          id: 18,
          amount: 120,
          type: 'earn' as const,
          description: '消费获得积分',
          createdAt: new Date('2024-11-20T10:30:00.000Z'),
        },
        {
          id: 19,
          amount: -50,
          type: 'spend' as const,
          description: '积分抵扣',
          createdAt: new Date('2024-11-21T14:00:00.000Z'),
        },
      ];

      clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
        customer,
      );
      clubPointsQueryService.listPointsRecords.mockResolvedValue({
        items: rows,
        total: 2,
        baseEffect: 0,
      });
      clubPointsQueryService.calculateSummary.mockResolvedValue({
        totalEarned: 800,
        totalRedeemed: 350,
      });

      const result = await service.listRecords(currentContext, {
        type: 'all',
      });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.nextCursor).not.toBeNull();
      expect(result.summary).toEqual({
        totalEarned: 800,
        totalRedeemed: 350,
      });
      expect(
        clubPointsQueryService.findCustomerByStoreAndPhone,
      ).toHaveBeenCalledWith(11, currentContext.user.phone);
      expect(clubPointsQueryService.listPointsRecords).toHaveBeenCalledWith(
        11,
        98,
        'all',
        { limit: undefined, cursor: undefined },
      );
      expect(clubPointsQueryService.calculateSummary).toHaveBeenCalledWith(
        11,
        98,
      );
    });

    it('summary 不依赖 items 数量，始终取自后端聚合', async () => {
      const customer = { id: 98, points: 580 };

      clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
        customer,
      );
      // 即使 items 为空（如筛选结果为空）
      clubPointsQueryService.listPointsRecords.mockResolvedValue({
        items: [],
        total: 0,
        baseEffect: 0,
      });
      // summary 仍返回真实全量统计
      clubPointsQueryService.calculateSummary.mockResolvedValue({
        totalEarned: 800,
        totalRedeemed: 350,
      });

      const result = await service.listRecords(currentContext, {
        type: 'redeem',
      });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.nextCursor).toBeNull();
      // summary 反映完整业务统计，不是当前可见列表统计
      expect(result.summary).toEqual({
        totalEarned: 800,
        totalRedeemed: 350,
      });
    });
  });

  describe('游标分页', () => {
    it('翻页时透传 limit 与解析后的游标', async () => {
      const customer = { id: 98, points: 580 };
      const rows = [
        {
          id: 18,
          amount: 120,
          type: 'earn' as const,
          description: '消费获得积分',
          createdAt: new Date('2024-11-20T10:30:00.000Z'),
        },
      ];

      clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
        customer,
      );
      clubPointsQueryService.listPointsRecords.mockResolvedValue({
        items: rows,
        total: 20,
        baseEffect: 500,
      });
      clubPointsQueryService.calculateSummary.mockResolvedValue({
        totalEarned: 800,
        totalRedeemed: 350,
      });

      // 构造合法游标：createdAt + id + totalEffect
      const cursor = Buffer.from(
        JSON.stringify({
          createdAt: '2024-11-20T10:30:00.000Z',
          id: 18,
          totalEffect: 500,
        }),
        'utf8',
      ).toString('base64url');

      const result = await service.listRecords(currentContext, {
        type: 'earn',
        limit: 20,
        cursor,
      });

      expect(clubPointsQueryService.listPointsRecords).toHaveBeenCalledWith(
        11,
        98,
        'earn',
        {
          limit: 20,
          cursor: {
            createdAt: '2024-11-20T10:30:00.000Z',
            id: 18,
            totalEffect: 500,
          },
        },
      );
      // nextCursor 的 totalEffect = baseEffect + 本页变动量（500 + 120）
      expect(result.nextCursor).not.toBeNull();
      const decoded = JSON.parse(
        Buffer.from(result.nextCursor ?? '', 'base64url').toString('utf8'),
      ) as { totalEffect?: number };
      expect(decoded.totalEffect).toBe(620);
    });

    it('非法游标抛出 BadRequestException', async () => {
      await expect(
        service.listRecords(currentContext, { cursor: 'not-a-cursor' }),
      ).rejects.toThrow('分页游标解析失败');
    });

    it('分页快照以 baseEffect 为基准连续正推', async () => {
      const customer = { id: 98, points: 580 };
      // 第二页：仅一条 -50 的记录，游标之前已加载累计 500
      const rows = [
        {
          id: 12,
          amount: -50,
          type: 'spend' as const,
          description: '积分抵扣',
          createdAt: new Date('2024-11-19T10:00:00.000Z'),
        },
      ];

      clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
        customer,
      );
      clubPointsQueryService.listPointsRecords.mockResolvedValue({
        items: rows,
        total: 3,
        baseEffect: 500,
      });
      clubPointsQueryService.calculateSummary.mockResolvedValue({
        totalEarned: 800,
        totalRedeemed: 350,
      });

      const result = await service.listRecords(currentContext, {});

      // 起点 = 580 - 500 - (-50) = 130；扣减 -50 后余额快照 = 80
      expect(result.items[0].balanceSnapshot).toBe(80);
    });
  });
});
