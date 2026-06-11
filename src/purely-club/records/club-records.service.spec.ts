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
    accountScope: 'purely_club',
    currentMembership: null,
  };

  const currentContext = {
    user,
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
    clubRecordQueryService.listLedgerEntries.mockResolvedValue(entries);
    clubRecordViewService.buildRecordItems.mockReturnValue(items);

    await expect(service.list(currentContext, {})).resolves.toEqual({ items });
    expect(
      clubRecordQueryService.findCustomerByStoreAndPhone,
    ).toHaveBeenCalledWith(11, user.phone);
    expect(clubRecordQueryService.listLedgerEntries).toHaveBeenCalledWith(
      11,
      98,
    );
    expect(clubRecordViewService.buildRecordItems).toHaveBeenCalledWith({
      entries,
      filterType: 'all',
      customer,
      storeName: 'purelyClub · 望京旗舰店',
    });
  });

  it('list 透传筛选类型给 view service', async () => {
    const customer = { id: 98, balance: 58000 };
    clubRecordQueryService.findCustomerByStoreAndPhone.mockResolvedValue(
      customer,
    );
    clubRecordQueryService.listLedgerEntries.mockResolvedValue([]);
    clubRecordViewService.buildRecordItems.mockReturnValue([]);

    await expect(service.list(currentContext, { type: 'recharge' })).resolves.toEqual({
      items: [],
    });
    expect(clubRecordViewService.buildRecordItems).toHaveBeenCalledWith(
      expect.objectContaining({ filterType: 'recharge' }),
    );
  });

  it('list 在当前门店没有营销顾客档案时返回空列表', async () => {
    clubRecordQueryService.findCustomerByStoreAndPhone.mockResolvedValue(null);

    await expect(service.list(currentContext, {})).resolves.toEqual({ items: [] });
    expect(clubRecordQueryService.listLedgerEntries).not.toHaveBeenCalled();
    expect(clubRecordViewService.buildRecordItems).not.toHaveBeenCalled();
  });
});
