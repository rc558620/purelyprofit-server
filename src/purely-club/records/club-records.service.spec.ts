import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubStoresService } from '../stores/club-stores.service';
import { ClubRecordsService } from './club-records.service';

describe('ClubRecordsService', () => {
  let service: ClubRecordsService;

  const prismaService = {
    marketingCustomer: {
      findUnique: jest.fn(),
    },
    marketingRecharge: {
      findMany: jest.fn(),
    },
    marketingConsumption: {
      findMany: jest.fn(),
    },
  };

  const clubStoresService = {
    getCurrent: jest.fn(),
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

  beforeEach(async () => {
    jest.clearAllMocks();
    clubStoresService.getCurrent.mockResolvedValue({
      id: 11,
      name: 'purelyClub · 望京旗舰店',
      address: '北京市朝阳区望京 SOHO T3 B1',
      coverImage: 'https://cdn.example.com/store-cover.png',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubRecordsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubStoresService, useValue: clubStoresService },
      ],
    }).compile();

    service = module.get<ClubRecordsService>(ClubRecordsService);
  });

  it('list 聚合当前门店充值赠送消费退款流水并计算余额快照', async () => {
    prismaService.marketingCustomer.findUnique.mockResolvedValue({
      id: 98,
      balance: 35000,
    });
    prismaService.marketingRecharge.findMany.mockResolvedValue([
      {
        id: 18,
        amount: 50000,
        giftAmount: 8000,
        type: 'recharge',
        note: null,
        createdAt: new Date('2024-11-20T10:30:00.000Z'),
      },
      {
        id: 16,
        amount: 0,
        giftAmount: 5000,
        type: 'gift',
        note: '黄金会员生日礼品券',
        createdAt: new Date('2024-10-01T00:00:00.000Z'),
      },
      {
        id: 15,
        amount: 10000,
        giftAmount: 0,
        type: 'refund',
        note: '退款 ¥100',
        createdAt: new Date('2024-09-18T09:00:00.000Z'),
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

    await expect(service.list(user, {})).resolves.toEqual({
      items: [
        {
          id: 'recharge-18',
          type: 'recharge',
          amount: 500,
          description: '充值 ¥500 赠 ¥80',
          createdAt: '2024-11-20T10:30:00.000Z',
          balanceSnapshot: 350,
          storeName: 'purelyClub · 望京旗舰店',
        },
        {
          id: 'consume-31',
          type: 'consume',
          amount: -199,
          description: '购买经典养护套餐',
          createdAt: '2024-11-18T14:20:00.000Z',
          balanceSnapshot: -230,
          storeName: 'purelyClub · 望京旗舰店',
        },
        {
          id: 'bonus-16',
          type: 'bonus',
          amount: 50,
          description: '黄金会员生日礼品券',
          createdAt: '2024-10-01T00:00:00.000Z',
          balanceSnapshot: -31,
          storeName: 'purelyClub · 望京旗舰店',
        },
        {
          id: 'refund-15',
          type: 'refund',
          amount: -100,
          description: '退款 ¥100',
          createdAt: '2024-09-18T09:00:00.000Z',
          balanceSnapshot: -81,
          storeName: 'purelyClub · 望京旗舰店',
        },
      ],
    });
  });

  it('list 支持按 recharge 过滤充值与赠送流水', async () => {
    prismaService.marketingCustomer.findUnique.mockResolvedValue({
      id: 98,
      balance: 58000,
    });
    prismaService.marketingRecharge.findMany.mockResolvedValue([
      {
        id: 18,
        amount: 50000,
        giftAmount: 8000,
        type: 'recharge',
        note: null,
        createdAt: new Date('2024-11-20T10:30:00.000Z'),
      },
      {
        id: 16,
        amount: 0,
        giftAmount: 5000,
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

    await expect(service.list(user, { type: 'recharge' })).resolves.toEqual({
      items: [
        expect.objectContaining({ id: 'recharge-18', type: 'recharge' }),
        expect.objectContaining({ id: 'bonus-16', type: 'bonus' }),
      ],
    });
  });

  it('list 在当前门店没有营销顾客档案时返回空列表', async () => {
    prismaService.marketingCustomer.findUnique.mockResolvedValue(null);

    await expect(service.list(user, {})).resolves.toEqual({ items: [] });
    expect(prismaService.marketingRecharge.findMany).not.toHaveBeenCalled();
    expect(prismaService.marketingConsumption.findMany).not.toHaveBeenCalled();
  });
});
