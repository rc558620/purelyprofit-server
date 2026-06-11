import { ClubRecordViewService } from './club-record-view.service';

describe('ClubRecordViewService', () => {
  let service: ClubRecordViewService;

  beforeEach(() => {
    service = new ClubRecordViewService();
  });

  it('buildRecordItems 计算余额快照并输出展示结构', () => {
    expect(
      service.buildRecordItems({
        entries: [
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
        ],
        filterType: 'all',
        customer: {
          id: 98,
          balance: 35000,
        },
        storeName: 'purelyClub · 望京旗舰店',
      }),
    ).toEqual([
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
    ]);
  });

  it('buildRecordItems 支持按 recharge 过滤充值与赠送流水', () => {
    expect(
      service.buildRecordItems({
        entries: [
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
        ],
        filterType: 'recharge',
        customer: {
          id: 98,
          balance: 58000,
        },
        storeName: 'purelyClub · 望京旗舰店',
      }),
    ).toEqual([
      expect.objectContaining({ id: 'recharge-18', type: 'recharge' }),
      expect.objectContaining({ id: 'bonus-16', type: 'bonus' }),
    ]);
  });
});
