import type { Prisma } from '@prisma/client';
import { applyCustomerMetrics } from './club-customer-metrics.helper';

interface Row {
  total_spent: number;
  visit_count: number;
  balance: number;
  points: number;
  tier: 'regular' | 'gold' | 'diamond';
}

const buildTx = (rows: Row[]) => {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findUnique = jest.fn().mockResolvedValue(null);
  const queryRaw = jest.fn().mockResolvedValue(rows);
  return {
    $queryRaw: queryRaw,
    queryRaw,
    updateMany,
    tx: {
      $queryRaw: queryRaw,
      marketingCustomer: { updateMany },
      marketingMemberLevelSetting: { findUnique },
    } as unknown as Prisma.TransactionClient,
  };
};

const sqlOf = (queryRaw: jest.Mock): string =>
  (queryRaw.mock.calls[0][0] as unknown as string[]).join(' ');

/** Prisma.sql 拼接片段会作为插值参数传入，不会出现在模板字符串数组里 */
const fragmentsOf = (queryRaw: jest.Mock): string =>
  (queryRaw.mock.calls[0].slice(1) as unknown[])
    .filter(
      (value): value is { sql: string } =>
        typeof value === 'object' && value !== null && 'sql' in value,
    )
    .map((value) => value.sql)
    .join(' | ');

const params = {
  customerId: 7,
  storeId: 11,
  tierThresholds: { gold: 1000, diamond: 5000 },
};

describe('applyCustomerMetrics', () => {
  it('累计消费与次数走 SQL 侧原子增减，不读旧值再写回', async () => {
    const { tx, queryRaw } = buildTx([
      {
        total_spent: 1200,
        visit_count: 3,
        balance: 500,
        points: 12,
        tier: 'regular',
      },
    ]);

    const result = await applyCustomerMetrics(tx, {
      ...params,
      totalSpentDelta: 200,
      visitCountDelta: 1,
      touchLastVisitAt: true,
    });

    expect(result).toEqual({
      totalSpent: 1200,
      visitCount: 3,
      balance: 500,
      points: 12,
      tier: 'gold',
    });
    const sql = sqlOf(queryRaw);
    expect(sql).toContain('total_spent = GREATEST(total_spent +');
    expect(sql).toContain('visit_count = GREATEST(visit_count +');
    expect(sql).toContain("NOW() AT TIME ZONE 'UTC'");
    expect(sql).toContain('deleted_at IS NULL');
  });

  it('跨等级档位时补一次条件写 tier', async () => {
    const { tx, updateMany } = buildTx([
      {
        total_spent: 1200,
        visit_count: 1,
        balance: 0,
        points: 0,
        tier: 'regular',
      },
    ]);

    await applyCustomerMetrics(tx, { ...params, totalSpentDelta: 200 });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 7, storeId: 11, tier: { not: 'gold' } },
      data: { tier: 'gold' },
    });
  });

  it('等级未变化时不产生第二段写入', async () => {
    const { tx, updateMany } = buildTx([
      {
        total_spent: 1200,
        visit_count: 1,
        balance: 0,
        points: 0,
        tier: 'gold',
      },
    ]);

    await applyCustomerMetrics(tx, { ...params, totalSpentDelta: 200 });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('指标未变化（纯扣余额）时不重算等级、不查配置', async () => {
    const { tx, updateMany, queryRaw } = buildTx([
      {
        total_spent: 800,
        visit_count: 1,
        balance: 400,
        points: 5,
        tier: 'regular',
      },
    ]);

    const result = await applyCustomerMetrics(tx, {
      ...params,
      balanceDelta: -100,
      requireBalanceGte: 100,
    });

    expect(result?.tier).toBe('regular');
    expect(updateMany).not.toHaveBeenCalled();
    expect(fragmentsOf(queryRaw)).toContain('AND balance >=');
  });

  it('条件未命中返回 null，调用方据此抛余额不足或跳过', async () => {
    const { tx } = buildTx([]);

    await expect(
      applyCustomerMetrics(tx, {
        ...params,
        balanceDelta: -100,
        requireBalanceGte: 100,
      }),
    ).resolves.toBeNull();
  });

  it('requireActive 把 active 条件写进同一条 UPDATE', async () => {
    const { tx, queryRaw } = buildTx([
      {
        total_spent: 0,
        visit_count: 0,
        balance: 0,
        points: 0,
        tier: 'regular',
      },
    ]);

    await applyCustomerMetrics(tx, {
      ...params,
      balanceDelta: -1,
      requireActive: true,
    });

    expect(fragmentsOf(queryRaw)).toContain("AND status = 'active'");
  });
});
