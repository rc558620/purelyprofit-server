import type { Prisma } from '@prisma/client';
import {
  aggregateStockRelease,
  applyStockRelease,
} from './scan-ordering-stock-release.helper';
import type { StockReleaseItem } from './scan-ordering-stock-release.helper';

const buildItem = (
  menuProductId: number,
  quantity: number,
  specOptionIds: number[],
  productId: number | null = 901,
): StockReleaseItem => ({
  menuProductId,
  quantity,
  productId,
  specOptionIds,
});

describe('aggregateStockRelease', () => {
  it('同一菜单商品多行合并数量，规格按订单项数量求和', () => {
    const plan = aggregateStockRelease([
      buildItem(201, 2, [301, 302], 901),
      buildItem(202, 3, [301, 303], null),
    ]);

    expect(plan.menuProducts).toEqual([
      { id: 201, quantity: 2, productId: 901 },
      { id: 202, quantity: 3, productId: null },
    ]);
    expect(plan.specOptions).toEqual([
      { id: 301, quantity: 5 },
      { id: 302, quantity: 2 },
      { id: 303, quantity: 3 },
    ]);
  });

  it('同一菜单商品被拆成多行时数量累加，避免 VALUES 重复 ID 静默丢数量', () => {
    const plan = aggregateStockRelease([
      buildItem(201, 2, [301]),
      buildItem(201, 3, [301]),
    ]);

    expect(plan.menuProducts).toEqual([
      { id: 201, quantity: 5, productId: 901 },
    ]);
    expect(plan.specOptions).toEqual([{ id: 301, quantity: 5 }]);
  });

  it('同一规格出现在 3 个商品行时按数量求和，而不是按出现次数', () => {
    const plan = aggregateStockRelease([
      buildItem(201, 1, [501], 901),
      buildItem(202, 1, [501], null),
      buildItem(203, 1, [501], 903),
    ]);

    expect(plan.specOptions).toEqual([{ id: 501, quantity: 3 }]);
    expect(plan.menuProducts).toHaveLength(3);
  });

  it('不同商品行的规格分别聚合', () => {
    const plan = aggregateStockRelease([
      buildItem(201, 5, [601, 602]),
      buildItem(202, 4, [602, 603]),
    ]);

    expect(plan.specOptions).toEqual([
      { id: 601, quantity: 5 },
      { id: 602, quantity: 9 },
      { id: 603, quantity: 4 },
    ]);
  });

  it('空订单产生空计划', () => {
    expect(aggregateStockRelease([])).toEqual({
      menuProducts: [],
      specOptions: [],
    });
  });
});

describe('applyStockRelease', () => {
  /** 第一次 $queryRaw 返回菜单商品释放结果，第二次返回规格释放结果 */
  const buildTx = (menuIds: number[], specIds: number[]) => {
    let queryCall = 0;
    return {
      $queryRaw: jest.fn().mockImplementation(() => {
        queryCall += 1;
        const ids = queryCall === 1 ? menuIds : specIds;
        return Promise.resolve(ids.map((id) => ({ id })));
      }),
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
  };

  const executedSql = (tx: ReturnType<typeof buildTx>): string =>
    tx.$executeRaw.mock.calls
      .map((call) => (call[0] as unknown as string[]).join(' '))
      .join('\n');

  const plan = aggregateStockRelease([
    buildItem(201, 2, [301, 302], 901),
    buildItem(202, 3, [303], 902),
  ]);

  it('预留全部命中时只做两次 RETURNING 查询，不执行任何恢复 SQL', async () => {
    const tx = buildTx([201, 202], [301, 302, 303]);

    await applyStockRelease(
      tx as unknown as Prisma.TransactionClient,
      11,
      plan,
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('预留全部未命中时执行菜单商品 / 商品库 / 规格三段恢复 SQL', async () => {
    const tx = buildTx([], []);

    await applyStockRelease(
      tx as unknown as Prisma.TransactionClient,
      11,
      plan,
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(executedSql(tx)).toContain(
      'UPDATE scan_ordering_menu_products AS m',
    );
    expect(executedSql(tx)).toContain('UPDATE products AS p');
    expect(executedSql(tx)).toContain('UPDATE scan_ordering_spec_options AS o');
    // finite 判断必须留在 SQL 条件里，不能依赖应用层字段
    expect(executedSql(tx)).toContain("m.stock_mode = 'finite'");
  });

  it('部分命中时仍执行恢复分支，VALUES 只包含未命中行', async () => {
    const tx = buildTx([201], [301]);

    await applyStockRelease(
      tx as unknown as Prisma.TransactionClient,
      11,
      plan,
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(executedSql(tx)).toContain(
      'UPDATE scan_ordering_menu_products AS m',
    );
    expect(executedSql(tx)).toContain('UPDATE scan_ordering_spec_options AS o');
  });

  it('空计划不产生任何 SQL', async () => {
    const tx = buildTx([], []);

    await applyStockRelease(tx as unknown as Prisma.TransactionClient, 11, {
      menuProducts: [],
      specOptions: [],
    });

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('未绑定商品库时不回补 Product.stock，但仍恢复菜单商品库存', async () => {
    const unbound = aggregateStockRelease([buildItem(201, 1, [], null)]);
    const tx = buildTx([], []);

    await applyStockRelease(
      tx as unknown as Prisma.TransactionClient,
      11,
      unbound,
    );

    expect(executedSql(tx)).not.toContain('UPDATE products');
    expect(executedSql(tx)).toContain(
      'UPDATE scan_ordering_menu_products AS m',
    );
  });
});
