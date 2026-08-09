import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubRecordQueryService } from './club-record-query.service';
import { ClubRecordViewService } from './club-record-view.service';
import { ClubRecordsService } from './club-records.service';

describe('ClubRecordsService', () => {
  let service: ClubRecordsService;

  const clubRecordQueryService = {
    findCustomerByStoreAndPhone: jest.fn(),
    listLedgerEntries: jest.fn(),
    calculateSummary: jest.fn(),
  };

  const clubRecordViewService = {
    buildRecordItems: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '俱乐部用户',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    accountScope: 'purely_club',
    currentMembership: null,
  };

  const currentContext = {
    user,
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
        ClubRecordsService,
        { provide: ClubRecordQueryService, useValue: clubRecordQueryService },
        { provide: ClubRecordViewService, useValue: clubRecordViewService },
      ],
    }).compile();

    service = module.get<ClubRecordsService>(ClubRecordsService);
  });

  it('list 聚合当前门店流水并委托 view service 构建响应', async () => {
    const customer = { id: 98, balance: 35000 };
    const entries = [
      {
        id: 'recharge-18',
        type: 'recharge',
        amountFen: 50000,
        balanceEffectFen: 58000,
        description: '充值 ¥500 赠 ¥80',
        createdAt: new Date('2024-11-20T10:30:00.000Z'),
      },
    ];
    const items = [
      {
        id: 'recharge-18',
        type: 'recharge',
        amount: 500,
        description: '充值 ¥500 赠 ¥80',
        createdAt: '2024-11-20T10:30:00.000Z',
        balanceSnapshot: 350,
        storeName: 'purelyClub · 望京旗舰店',
      },
    ];

    clubRecordQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
      customer,
    );
    clubRecordQueryService.listLedgerEntries.mockResolvedValue({
      items: entries,
      total: 1,
    });
    clubRecordQueryService.calculateSummary.mockResolvedValue({
      totalRechargeAmount: 580,
      totalConsumeAmount: 0,
    });
    clubRecordViewService.buildRecordItems.mockReturnValue(items);

    await expect(service.list(currentContext, {})).resolves.toEqual({
      items,
      total: 1, // 筛选后条目数 = items.length
      nextCursor: Buffer.from(
        JSON.stringify({
          createdAt: '2024-11-20T10:30:00.000Z',
          id: 'recharge-18',
        }),
      ).toString('base64url'),
      summary: {
        totalRechargeAmount: 580,
        totalConsumeAmount: 0,
      },
    });
    expect(
      clubRecordQueryService.findCustomerByStoreAndPhone,
    ).toHaveBeenCalledWith(11, user.phone);
    expect(clubRecordQueryService.listLedgerEntries).toHaveBeenCalledWith(
      11,
      98,
      { limit: undefined, cursor: undefined, filterType: 'all' },
    );
    expect(clubRecordViewService.buildRecordItems).toHaveBeenCalledWith({
      entries,
      filterType: 'all',
      customer,
      storeName: 'purelyClub · 望京旗舰店',
    });
  });

  it('list 透传筛选类型和单参数游标给下游', async () => {
    const customer = { id: 98, balance: 58000 };
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: '2024-11-20T10:30:00.000Z',
        id: 'recharge-18',
      }),
    ).toString('base64url');
    clubRecordQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
      customer,
    );
    clubRecordQueryService.listLedgerEntries.mockResolvedValue({
      items: [],
      total: 0,
    });
    clubRecordQueryService.calculateSummary.mockResolvedValue({
      totalRechargeAmount: 580,
      totalConsumeAmount: 199,
    });
    clubRecordViewService.buildRecordItems.mockReturnValue([]);

    await expect(
      service.list(currentContext, {
        type: 'recharge',
        cursor,
      }),
    ).resolves.toEqual({
      items: [],
      total: 0,
      nextCursor: null,
      summary: {
        totalRechargeAmount: 580,
        totalConsumeAmount: 199,
      },
    });
    expect(clubRecordViewService.buildRecordItems).toHaveBeenCalledWith(
      expect.objectContaining({ filterType: 'recharge' }),
    );
    expect(clubRecordQueryService.listLedgerEntries).toHaveBeenCalledWith(
      11,
      98,
      {
        limit: undefined,
        cursor: {
          createdAt: new Date('2024-11-20T10:30:00.000Z'),
          id: 'recharge-18',
        },
        filterType: 'recharge',
      },
    );
  });

  it('list 收到非法游标时抛出 400', async () => {
    const customer = { id: 98, balance: 58000 };
    clubRecordQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
      customer,
    );

    await expect(
      service.list(currentContext, { cursor: 'not-a-valid-cursor' }),
    ).rejects.toThrow('分页游标解析失败');
  });

  it('list 在当前门店没有营销顾客档案时返回空列表', async () => {
    clubRecordQueryService.findCustomerByStoreAndPhone.mockResolvedValue(null);

    await expect(service.list(currentContext, {})).resolves.toEqual({
      items: [],
      total: 0,
      nextCursor: null,
      summary: {
        totalRechargeAmount: 0,
        totalConsumeAmount: 0,
      },
    });
    expect(clubRecordQueryService.listLedgerEntries).not.toHaveBeenCalled();
    expect(clubRecordViewService.buildRecordItems).not.toHaveBeenCalled();
  });

  it('list 返回查询层按类型筛选后的 total', async () => {
    const customer = { id: 98, balance: 35000 };
    // 模拟 query 返回筛选后总数 4 条，view 层再过滤无效行后实际返回 2 条
    const entries = [
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
    ];
    // 模拟 view service 筛选后只返回 recharge 类型的 1 条
    const filteredItems = [
      {
        id: 'recharge-18',
        type: 'recharge',
        amount: 500,
        description: '充值 ¥500 赠 ¥80',
        createdAt: '2024-11-20T10:30:00.000Z',
        balanceSnapshot: 580,
        storeName: 'purelyClub · 望京旗舰店',
      },
    ];

    clubRecordQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
      customer,
    );
    clubRecordQueryService.listLedgerEntries.mockResolvedValue({
      items: entries,
      total: 4, // 查询层按类型筛选后的总数
    });
    clubRecordQueryService.calculateSummary.mockResolvedValue({
      totalRechargeAmount: 500,
      totalConsumeAmount: 199,
    });
    clubRecordViewService.buildRecordItems.mockReturnValue(filteredItems);

    const result = await service.list(currentContext, { type: 'recharge' });
    // total 应为查询层筛选后的总条数，而非当前页 items 条数
    expect(result.total).toBe(4);
  });
});
