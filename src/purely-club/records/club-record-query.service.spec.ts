import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubRecordQueryService } from './club-record-query.service';

describe('ClubRecordQueryService', () => {
  let service: ClubRecordQueryService;

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

  it('findCustomerByStoreAndPhone 按门店与手机号查询顾客余额档案', async () => {
    prismaService.marketingCustomer.findUnique.mockResolvedValue({
      id: 98,
      balance: 35000,
    });

    await expect(
      service.findCustomerByStoreAndPhone(11, '13800138000'),
    ).resolves.toEqual({
      id: 98,
      balance: 35000,
    });
    expect(prismaService.marketingCustomer.findUnique).toHaveBeenCalledWith({
      where: {
        storeId_phone: {
          storeId: 11,
          phone: '13800138000',
        },
      },
      select: {
        id: true,
        balance: true,
      },
    });
  });

  it('listLedgerEntries 聚合充值赠送消费退款流水并按时间倒序返回', async () => {
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

    await expect(service.listLedgerEntries(11, 98)).resolves.toEqual([
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
        balanceEffectFen: 5000,
        description: '黄金会员生日礼品券',
        createdAt: new Date('2024-10-01T00:00:00.000Z'),
      },
      {
        id: 'refund-15',
        type: 'refund',
        amountFen: -10000,
        balanceEffectFen: -10000,
        description: '退款 ¥100',
        createdAt: new Date('2024-09-18T09:00:00.000Z'),
      },
    ]);
  });

  it('listLedgerEntries 过滤无效赠送与无效消费记录', async () => {
    prismaService.marketingRecharge.findMany.mockResolvedValue([
      {
        id: 16,
        amount: 0,
        giftAmount: 0,
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

    await expect(service.listLedgerEntries(11, 98)).resolves.toEqual([]);
  });
});
