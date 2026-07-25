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
      });
      clubPointsQueryService.calculateSummary.mockResolvedValue({
        totalEarned: 800,
        totalRedeemed: 350,
      });

      const result = await service.listRecords(currentContext, { type: 'all' });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
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
      // summary 反映完整业务统计，不是当前可见列表统计
      expect(result.summary).toEqual({
        totalEarned: 800,
        totalRedeemed: 350,
      });
    });
  });
});
