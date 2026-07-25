import {
  buildBeanOverview,
  buildPointsOverview,
} from './platform-membership-ledger.domain';
import type { StoreMembershipPointsLogRecord } from './platform-membership.types';

describe('buildBeanOverview pendingBeans', () => {
  it('无合伙人时返回全零，pendingBeans 为 0', () => {
    const result = buildBeanOverview(null);

    expect(result).toEqual({
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
      pendingBeans: 0,
    });
  });

  it('正常场景：totalEarnedBeans > totalWithdrawnBeans + beanBalance，pendingBeans 为正数', () => {
    const result = buildBeanOverview({
      status: 'approved',
      beanBalance: 100,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 200,
    });

    expect(result).toEqual({
      beanBalance: 100,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 200,
      pendingBeans: 200, // 500 - 200 - 100 = 200
    });
  });

  it('钗制场景：totalEarnedBeans = totalWithdrawnBeans + beanBalance，pendingBeans 为 0', () => {
    const result = buildBeanOverview({
      status: 'approved',
      beanBalance: 300,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 200,
    });

    expect(result).toEqual({
      beanBalance: 300,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 200,
      pendingBeans: 0, // 500 - 200 - 300 = 0
    });
  });

  it('钗制场景：totalEarnedBeans < totalWithdrawnBeans + beanBalance，pendingBeans 钗制为 0', () => {
    const result = buildBeanOverview({
      status: 'approved',
      beanBalance: 400,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 200,
    });

    expect(result).toEqual({
      beanBalance: 400,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 200,
      pendingBeans: 0, // 500 - 200 - 400 = -100 → clamped to 0
    });
  });
});

describe('buildPointsOverview deductibleAmount & canUsePoints', () => {
  const makeLogs = (
    overrides: Partial<StoreMembershipPointsLogRecord>[] = [],
  ) =>
    overrides.map(
      (o, i) =>
        ({
          id: i + 1,
          source: 'purchase_bonus',
          changeType: 'increase' as const,
          changeAmount: 100,
          description: '测试积分',
          expireAt: null,
          createdAt: new Date(),
          ...o,
        }) satisfies StoreMembershipPointsLogRecord,
    );

  it('0 积分：deductibleAmount=0, canUsePoints=false', () => {
    const result = buildPointsOverview(0, makeLogs());
    expect(result.deductibleAmount).toBe(0);
    expect(result.canUsePoints).toBe(false);
  });

  it('99 积分（不足 100）：deductibleAmount=0, canUsePoints=false', () => {
    const result = buildPointsOverview(99, makeLogs());
    expect(result.deductibleAmount).toBe(0);
    expect(result.canUsePoints).toBe(false);
  });

  it('100 积分（恰好 1 元）：deductibleAmount=100, canUsePoints=true', () => {
    const result = buildPointsOverview(100, makeLogs());
    expect(result.deductibleAmount).toBe(100);
    expect(result.canUsePoints).toBe(true);
  });

  it('150 积分：向下取整为 1 元，deductibleAmount=100', () => {
    const result = buildPointsOverview(150, makeLogs());
    expect(result.deductibleAmount).toBe(100);
    expect(result.canUsePoints).toBe(true);
  });

  it('1234 积分：向下取整为 12 元，deductibleAmount=1200', () => {
    const result = buildPointsOverview(1234, makeLogs());
    expect(result.deductibleAmount).toBe(1200);
    expect(result.canUsePoints).toBe(true);
  });

  it('totalEarned / totalSpent 仍按 logs 聚合，不受 deductibleAmount 影响', () => {
    const result = buildPointsOverview(
      500,
      makeLogs([
        { changeType: 'increase', changeAmount: 300 },
        { changeType: 'increase', changeAmount: 200 },
        { changeType: 'decrease', changeAmount: 50 },
      ]),
    );
    expect(result.totalEarned).toBe(500);
    expect(result.totalSpent).toBe(50);
    expect(result.availablePoints).toBe(500);
    expect(result.deductibleAmount).toBe(500); // 500/100*100 = 500
  });

  it('自定义 pointsRate=200 时正确计算', () => {
    const result = buildPointsOverview(300, makeLogs(), 200);
    expect(result.deductibleAmount).toBe(100); // 300/200=1.5 floor=1 *100=100
    expect(result.canUsePoints).toBe(true); // 300 >= 200
  });
});

describe('buildBeanOverview 直接取传入的合伙人', () => {
  it('传入 approved 合伙人时正确返回', () => {
    const result = buildBeanOverview({
      status: 'approved',
      beanBalance: 200,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 100,
    });

    expect(result).toEqual({
      beanBalance: 200,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 100,
      pendingBeans: 200, // 500 - 100 - 200 = 200
    });
  });
});
