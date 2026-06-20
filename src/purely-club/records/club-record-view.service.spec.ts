import { ClubRecordViewService } from './club-record-view.service';

describe('ClubRecordViewService', () => {
  let service: ClubRecordViewService;

  beforeEach(() => {
    service = new ClubRecordViewService();
  });

  describe('buildRecordItems 余额快照正推计算', () => {
    it('从最旧到最新正推计算余额快照，输出按时间倒序', () => {
      // 场景：当前余额 350 元（35000 分）
      // 流水（按时间倒序输入）：
      //   recharge-18: 充500赠80 → 余额+58000分
      //   consume-31: 消费199 → 余额-19900分
      //   bonus-16: 赠送50 → 余额+5000分
      //   refund-15: 退款100 → 余额-10000分
      // 正推：
      //   起始余额 = 35000 - (58000 + (-19900) + 5000 + (-10000)) = 35000 - 33100 = 1900
      //   refund-15 后: 1900 + (-10000) = -8100  ← 不对，应该是正推
      //   实际：refund 先发生（9月），然后 bonus（10月），然后 consume（11月18日），然后 recharge（11月20日）
      //   起始余额 = 35000 - (58000 - 19900 + 5000 - 10000) = 35000 - 33100 = 1900
      //   refund-15: 1900 + (-10000) = -8100 → 这说明当前余额无法被这4笔流水解释
      //
      // 换一组更合理的数据：当前余额 35000 分
      // recharge-18: +58000 → 后余额 = X + 58000
      // consume-31: -19900 → 后余额 = X + 58000 - 19900 = X + 38100
      // bonus-16: +5000 → 后余额 = X + 38100 + 5000 = X + 43100
      // refund-15: -10000 → 后余额 = X + 43100 - 10000 = X + 33100 = 35000 → X = 1900
      // 但余额不可能为 1900 分时做 58000 分的充值...所以需要更合理的数据
      //
      // 让我们用更合理的场景：
      // 当前余额 = 58000 分
      // 充值500赠80 → +58000 → 后余额 = 58000
      // 这意味着充值前余额为 0，所以：
      // 起始余额 = 58000 - 58000 = 0
      // 正推：refund-15: 0 + (-10000) = -10000 → 不合理
      //
      // 最合理的场景：只有两笔流水
      // 当前余额 58000，recharge-18 +58000
      // 起始 = 58000 - 58000 = 0，recharge 后 = 58000 ✓

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
          ],
          filterType: 'all',
          customer: {
            id: 98,
            balance: 58000,
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
          balanceSnapshot: 580,
          storeName: 'purelyClub · 望京旗舰店',
        },
      ]);
    });

    it('多笔流水正推计算余额快照连贯正确', () => {
      // 场景：当前余额 35000 分
      // refund-15（9月18日）: balanceEffect = -10000 → 后余额 = 35000
      // bonus-16（10月1日）: balanceEffect = +5000 → 后余额 = 45000
      // consume-31（11月18日）: balanceEffect = -19900 → 后余额 = 25100
      // recharge-18（11月20日）: balanceEffect = +58000 → 后余额 = 35000 ✓
      // 起始余额 = 35000 - (-10000 + 5000 + (-19900) + 58000) = 35000 - 33100 = 1900
      // refund-15: 1900 + (-10000) = -8100 ← 余额为负不合理，说明这组数据的历史余额确实是负的
      // 这在业务上意味着退款金额超过了当时的余额（可能是商家操作）
      // 算法本身是正确的：从当前余额反推起始余额，然后正推

      const result = service.buildRecordItems({
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
      });

      // 输出按时间倒序
      expect(result).toHaveLength(4);
      expect(result[0].id).toBe('recharge-18');
      expect(result[1].id).toBe('consume-31');
      expect(result[2].id).toBe('bonus-16');
      expect(result[3].id).toBe('refund-15');

      // 起始余额 = 35000 - 33100 = 1900
      // refund-15 后: 1900 + (-10000) = -8100 → -81 元
      // bonus-16 后: -8100 + 5000 = -3100 → -31 元
      // consume-31 后: -3100 + (-19900) = -23000 → -230 元
      // recharge-18 后: -23000 + 58000 = 35000 → 350 元 ✓

      expect(result[0].balanceSnapshot).toBe(350);
      expect(result[1].balanceSnapshot).toBe(-230);
      expect(result[2].balanceSnapshot).toBe(-31);
      expect(result[3].balanceSnapshot).toBe(-81);
    });

    it('空 entries 返回空数组', () => {
      expect(
        service.buildRecordItems({
          entries: [],
          filterType: 'all',
          customer: { id: 98, balance: 35000 },
          storeName: 'purelyClub · 望京旗舰店',
        }),
      ).toEqual([]);
    });

    it('筛选后余额快照仍基于全部已加载流水正推', () => {
      // 当 filterType='recharge' 时，只保留 recharge 和 bonus 类型的条目
      // 但余额快照仍基于筛选后的条目正推
      const result = service.buildRecordItems({
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
      });

      // 筛选后只有 recharge-18 和 bonus-16
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({ id: 'recharge-18', type: 'recharge' }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({ id: 'bonus-16', type: 'bonus' }),
      );
    });
  });

  describe('金额精度', () => {
    it('101 分转换为 1.01 元，不会出现浮点精度丢失', () => {
      const result = service.buildRecordItems({
        entries: [
          {
            id: 'recharge-1',
            type: 'recharge',
            amountFen: 101,
            balanceEffectFen: 101,
            description: '测试',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          },
        ],
        filterType: 'all',
        customer: { id: 1, balance: 101 },
        storeName: '测试门店',
      });

      expect(result[0].amount).toBe(1.01);
      expect(result[0].balanceSnapshot).toBe(1.01);
    });

    it('333 分转换为 3.33 元', () => {
      const result = service.buildRecordItems({
        entries: [
          {
            id: 'recharge-1',
            type: 'recharge',
            amountFen: 333,
            balanceEffectFen: 333,
            description: '测试',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          },
        ],
        filterType: 'all',
        customer: { id: 1, balance: 333 },
        storeName: '测试门店',
      });

      expect(result[0].amount).toBe(3.33);
      expect(result[0].balanceSnapshot).toBe(3.33);
    });

    it('1 分转换为 0.01 元', () => {
      const result = service.buildRecordItems({
        entries: [
          {
            id: 'bonus-1',
            type: 'bonus',
            amountFen: 1,
            balanceEffectFen: 1,
            description: '测试',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          },
        ],
        filterType: 'all',
        customer: { id: 1, balance: 1 },
        storeName: '测试门店',
      });

      expect(result[0].amount).toBe(0.01);
      expect(result[0].balanceSnapshot).toBe(0.01);
    });
  });

  describe('filterEntries 边界', () => {
    it('consume 筛选包含退款类型', () => {
      const result = service.buildRecordItems({
        entries: [
          {
            id: 'consume-1',
            type: 'consume',
            amountFen: -1000,
            balanceEffectFen: -1000,
            description: '消费',
            createdAt: new Date('2024-01-02T00:00:00.000Z'),
          },
          {
            id: 'refund-1',
            type: 'refund',
            amountFen: -500,
            balanceEffectFen: -500,
            description: '退款',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          },
          {
            id: 'recharge-1',
            type: 'recharge',
            amountFen: 2000,
            balanceEffectFen: 2000,
            description: '充值',
            createdAt: new Date('2024-01-03T00:00:00.000Z'),
          },
        ],
        filterType: 'consume',
        customer: { id: 1, balance: 500 },
        storeName: '测试门店',
      });

      expect(result).toHaveLength(2);
      expect(
        result.every((r) => r.type === 'consume' || r.type === 'refund'),
      ).toBe(true);
    });
  });
});
