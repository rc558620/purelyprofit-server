import { buildBeanOverview } from './platform-membership-ledger.domain';

describe('buildBeanOverview pendingBeans', () => {
  it('无合伙人时返回全零，pendingBeans 为 0', () => {
    const result = buildBeanOverview([]);

    expect(result).toEqual({
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
      pendingBeans: 0,
    });
  });

  it('正常场景：totalEarnedBeans > totalWithdrawnBeans + beanBalance，pendingBeans 为正数', () => {
    const result = buildBeanOverview([
      {
        status: 'approved',
        beanBalance: 100,
        totalEarnedBeans: 500,
        totalWithdrawnBeans: 200,
      },
    ]);

    expect(result).toEqual({
      beanBalance: 100,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 200,
      pendingBeans: 200, // 500 - 200 - 100 = 200
    });
  });

  it('钳制场景：totalEarnedBeans = totalWithdrawnBeans + beanBalance，pendingBeans 为 0', () => {
    const result = buildBeanOverview([
      {
        status: 'approved',
        beanBalance: 300,
        totalEarnedBeans: 500,
        totalWithdrawnBeans: 200,
      },
    ]);

    expect(result).toEqual({
      beanBalance: 300,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 200,
      pendingBeans: 0, // 500 - 200 - 300 = 0
    });
  });

  it('钳制场景：totalEarnedBeans < totalWithdrawnBeans + beanBalance，pendingBeans 钳制为 0', () => {
    const result = buildBeanOverview([
      {
        status: 'approved',
        beanBalance: 400,
        totalEarnedBeans: 500,
        totalWithdrawnBeans: 200,
      },
    ]);

    expect(result).toEqual({
      beanBalance: 400,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 200,
      pendingBeans: 0, // 500 - 200 - 400 = -100 → clamped to 0
    });
  });

  it('多合伙人聚合：pendingBeans 为所有正式合伙人汇总后的钳制值', () => {
    const result = buildBeanOverview([
      {
        status: 'approved',
        beanBalance: 100,
        totalEarnedBeans: 300,
        totalWithdrawnBeans: 50,
      },
      {
        status: 'approved',
        beanBalance: 200,
        totalEarnedBeans: 400,
        totalWithdrawnBeans: 100,
      },
    ]);

    expect(result).toEqual({
      beanBalance: 300,   // 100 + 200
      totalEarnedBeans: 700, // 300 + 400
      totalWithdrawnBeans: 150, // 50 + 100
      pendingBeans: 250, // 700 - 150 - 300 = 250
    });
  });

  it('忽略非 approved 状态的合伙人', () => {
    const result = buildBeanOverview([
      {
        status: 'pending',
        beanBalance: 50,
        totalEarnedBeans: 100,
        totalWithdrawnBeans: 0,
      },
      {
        status: 'approved',
        beanBalance: 200,
        totalEarnedBeans: 500,
        totalWithdrawnBeans: 100,
      },
    ]);

    expect(result).toEqual({
      beanBalance: 200,
      totalEarnedBeans: 500,
      totalWithdrawnBeans: 100,
      pendingBeans: 200, // 500 - 100 - 200 = 200 (pending 合伙人被忽略)
    });
  });
});
