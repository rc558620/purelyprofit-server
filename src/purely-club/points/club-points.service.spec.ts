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
        balanceRecords: rows,
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
      ).toHaveBeenCalledWith(11, currentContext.user.phone, 201);
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
        balanceRecords: [],
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
        balanceRecords: rows,
      });
      clubPointsQueryService.calculateSummary.mockResolvedValue({
        totalEarned: 800,
        totalRedeemed: 350,
      });

      // 构造合法游标：createdAt + id
      const cursor = Buffer.from(
        JSON.stringify({
          createdAt: '2024-11-20T10:30:00.000Z',
          id: 18,
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
          },
        },
      );
      // 游标只回传定位所需的最后一条时间与 ID
      expect(result.nextCursor).not.toBeNull();
      const decoded = JSON.parse(
        Buffer.from(result.nextCursor ?? '', 'base64url').toString('utf8'),
      ) as { createdAt?: string; id?: number };
      expect(decoded.id).toBe(18);
      expect(decoded.createdAt).toBe('2024-11-20T10:30:00.000Z');
    });

    it('兼容旧游标：带 totalEffect 的历史游标仍可解析', async () => {
      const customer = { id: 98, points: 580 };
      clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
        customer,
      );
      clubPointsQueryService.listPointsRecords.mockResolvedValue({
        items: [],
        total: 0,
        balanceRecords: [],
      });
      clubPointsQueryService.calculateSummary.mockResolvedValue({
        totalEarned: 800,
        totalRedeemed: 350,
      });

      const legacyCursor = Buffer.from(
        JSON.stringify({
          createdAt: '2024-11-20T10:30:00.000Z',
          id: 18,
          totalEffect: 500,
        }),
        'utf8',
      ).toString('base64url');

      await expect(
        service.listRecords(currentContext, {
          type: 'earn',
          limit: 20,
          cursor: legacyCursor,
        }),
      ).resolves.toMatchObject({ total: 0 });

      expect(clubPointsQueryService.listPointsRecords).toHaveBeenCalledWith(
        11,
        98,
        'earn',
        {
          limit: 20,
          cursor: { createdAt: '2024-11-20T10:30:00.000Z', id: 18 },
        },
      );
    });

    it('非法游标抛出 BadRequestException', async () => {
      await expect(
        service.listRecords(currentContext, { cursor: 'not-a-cursor' }),
      ).rejects.toThrow('分页游标解析失败');
    });

    it('P1：筛选「获得」时快照仍为真实余额（不被排除的消耗带偏）', async () => {
      const customer = { id: 98, points: 120 };
      // 真实流水：E1(+100) → S(-30) → E2(+50)，当前余额 120
      const rows = [
        {
          id: 13,
          amount: 50,
          type: 'earn' as const,
          description: '消费获得积分',
          createdAt: new Date('2024-11-21T10:00:00.000Z'),
        },
        {
          id: 11,
          amount: 100,
          type: 'earn' as const,
          description: '消费获得积分',
          createdAt: new Date('2024-11-20T10:00:00.000Z'),
        },
      ];
      const balanceRecords = [
        {
          id: 11,
          amount: 100,
          createdAt: new Date('2024-11-20T10:00:00.000Z'),
        },
        {
          id: 12,
          amount: -30,
          createdAt: new Date('2024-11-20T12:00:00.000Z'),
        },
        { id: 13, amount: 50, createdAt: new Date('2024-11-21T10:00:00.000Z') },
      ];

      clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
        customer,
      );
      clubPointsQueryService.listPointsRecords.mockResolvedValue({
        items: rows,
        total: 2,
        balanceRecords,
      });
      clubPointsQueryService.calculateSummary.mockResolvedValue({
        totalEarned: 150,
        totalRedeemed: 30,
      });

      const result = await service.listRecords(currentContext, {
        type: 'earn',
      });

      // 起点 = 120 - (100 - 30 + 50) = 0 → E1 后 100、S 后 70、E2 后 120
      // 若误用筛选后的 rows 正推，E1 会被算成 70
      expect(result.items.map((item) => item.balanceSnapshot)).toEqual([
        120, 100,
      ]);
    });

    it('P1：同一事务写入的同刻记录按 ID 正推，快照不互换', async () => {
      const customer = { id: 98, points: 110 };
      const sameTime = new Date('2024-11-20T10:00:00.000Z');
      // 同刻（Postgres now() 取事务开始时间）：先抵扣 -30，后获得 +100
      const rows = [
        {
          id: 22,
          amount: 100,
          type: 'earn' as const,
          description: '消费获得积分',
          createdAt: sameTime,
        },
        {
          id: 21,
          amount: -30,
          type: 'spend' as const,
          description: '积分抵扣',
          createdAt: sameTime,
        },
      ];
      const balanceRecords = [
        { id: 21, amount: -30, createdAt: sameTime },
        { id: 22, amount: 100, createdAt: sameTime },
      ];

      clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
        customer,
      );
      clubPointsQueryService.listPointsRecords.mockResolvedValue({
        items: rows,
        total: 2,
        balanceRecords,
      });
      clubPointsQueryService.calculateSummary.mockResolvedValue({
        totalEarned: 100,
        totalRedeemed: 30,
      });

      const result = await service.listRecords(currentContext, {});

      // 起点 = 110 - 70 = 40 → 抵扣后 10、获得后 110
      expect(
        result.items.map((item) => [item.id, item.balanceSnapshot]),
      ).toEqual([
        ['points-22', 110],
        ['points-21', 10],
      ]);
    });

    it('P1：旧调用未返回 balanceRecords 时，倒序 rows 的同刻记录仍按 ID 定序', async () => {
      const customer = { id: 98, points: 110 };
      const sameTime = new Date('2024-11-20T10:00:00.000Z');
      const rows = [
        {
          id: 22,
          amount: 100,
          type: 'earn' as const,
          description: '消费获得积分',
          createdAt: sameTime,
        },
        {
          id: 21,
          amount: -30,
          type: 'spend' as const,
          description: '积分抵扣',
          createdAt: sameTime,
        },
      ];

      clubPointsQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
        customer,
      );
      // 查询层未返回快照基准（旧调用）：回退为本页 rows，排序必须自己补足 ID 次序
      clubPointsQueryService.listPointsRecords.mockResolvedValue({
        items: rows,
        total: 2,
        balanceRecords: [],
      });
      clubPointsQueryService.calculateSummary.mockResolvedValue({
        totalEarned: 100,
        totalRedeemed: 30,
      });

      const result = await service.listRecords(currentContext, {});

      expect(
        result.items.map((item) => [item.id, item.balanceSnapshot]),
      ).toEqual([
        ['points-22', 110],
        ['points-21', 10],
      ]);
    });
  });
});
