// 客存冻结库存聚合单测：口径（frozen + stored + 未软删）、空入参、脏数据截断
import {
  sumCustodyFrozenQty,
  resolveCustodyAvailableStock,
} from './custody-frozen-stock';
import type { CustodyFrozenStockClient } from './custody-frozen-stock';

/** 构造只暴露 custodyOrder.groupBy 的最小客户端，并记录最近一次查询条件 */
const createClient = (
  rows: Array<{
    productId: number | null;
    _sum: { remainingQty: number | null };
  }>,
): { client: CustodyFrozenStockClient; groupBy: jest.Mock } => {
  const groupBy = jest.fn().mockResolvedValue(rows);
  return {
    client: {
      custodyOrder: { groupBy },
    } as unknown as CustodyFrozenStockClient,
    groupBy,
  };
};

describe('sumCustodyFrozenQty', () => {
  it('只统计 frozen + 在存 + 未软删的存单', async () => {
    const { client, groupBy } = createClient([
      { productId: 101, _sum: { remainingQty: 5 } },
    ]);

    const result = await sumCustodyFrozenQty(client, 7, [101]);

    expect(result.get(101)).toBe(5);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 7,
          stockMode: 'frozen',
          status: 'stored',
          deletedAt: null,
        }),
      }),
    );
  });

  it('入参为空或非法时不查询数据库，返回空聚合', async () => {
    const { client, groupBy } = createClient([]);

    await expect(sumCustodyFrozenQty(client, 7, [])).resolves.toEqual(
      new Map(),
    );
    await expect(sumCustodyFrozenQty(client, 7, [0, -1, 1.5])).resolves.toEqual(
      new Map(),
    );
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('商品 ID 去重，避免重复聚合', async () => {
    const { client, groupBy } = createClient([]);

    await sumCustodyFrozenQty(client, 7, [101, 101, 102]);

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy.mock.calls[0][0].where.productId).toEqual({
      in: [101, 102],
    });
  });

  it('聚合结果缺失 productId 的行会被跳过', async () => {
    const { client } = createClient([
      { productId: null, _sum: { remainingQty: 9 } },
      { productId: 101, _sum: { remainingQty: null } },
    ]);

    const result = await sumCustodyFrozenQty(client, 7, [101]);

    expect(result.get(101)).toBe(0);
    expect(result.size).toBe(1);
  });
});

describe('resolveCustodyAvailableStock', () => {
  it('可用库存 = 物理库存 − 在存冻结量', async () => {
    const { client } = createClient([
      { productId: 101, _sum: { remainingQty: 3 } },
    ]);

    await expect(
      resolveCustodyAvailableStock(client, 7, 101, 10),
    ).resolves.toBe(7);
  });

  it('冻结量大于物理库存（脏数据）时截断为 0，不返回负数', async () => {
    const { client } = createClient([
      { productId: 101, _sum: { remainingQty: 12 } },
    ]);

    await expect(resolveCustodyAvailableStock(client, 7, 101, 5)).resolves.toBe(
      0,
    );
  });
});
