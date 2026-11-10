import type { PrismaService } from '../../../prisma/prisma.service';
import { queryInventoryProductPage } from './inventory-product-page.query';

const PAGE_PARAMS = {
  storeId: 18,
  query: {},
  skip: 0,
  take: 20,
};

function createPrisma(rows: unknown[] = []): {
  prisma: PrismaService;
  queryRaw: jest.Mock;
} {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  return {
    prisma: { $queryRaw: queryRaw } as unknown as PrismaService,
    queryRaw,
  };
}

/** 还原 tagged template 的完整 SQL：静态模板 + 插值进去的 Prisma.Sql 片段 */
function renderedSql(queryRaw: jest.Mock): string {
  const [strings, ...values] = queryRaw.mock.calls[0] as [
    TemplateStringsArray,
    ...unknown[],
  ];
  return strings.reduce((text, part, index) => {
    const value = values[index];
    // 参数值（数量/关键字等）不参与 SQL 文本断言，只拼接 Prisma.Sql 片段
    const fragment =
      value && typeof value === 'object' && 'sql' in value
        ? String((value as { sql: string }).sql)
        : '';
    return text + part + fragment;
  }, '');
}

describe('queryInventoryProductPage', () => {
  it('筛选、总数、稳定排序与 LIMIT 全部下推到库内，且限定门店与在售', async () => {
    const { prisma, queryRaw } = createPrisma();

    await queryInventoryProductPage(prisma, PAGE_PARAMS);

    const sql = renderedSql(queryRaw);
    expect(sql).toContain('COUNT(*) OVER()');
    expect(sql).toContain('LIMIT');
    expect(sql).toContain('OFFSET');
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('id ASC');
    expect(sql).toContain('store_id =');
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('is_active = true');
  });

  const alertFilterCases = [
    ['danger', 'AND stock <= 0'],
    ['warning', 'AND stock > 0 AND stock <= alert_threshold'],
    ['normal', 'AND stock > alert_threshold'],
  ] as const;

  it.each(alertFilterCases)(
    'alertLevel=%s 的跨字段筛选下推到库内',
    async (alertLevel, expected) => {
      const { prisma, queryRaw } = createPrisma();

      await queryInventoryProductPage(prisma, {
        ...PAGE_PARAMS,
        query: { alertLevel },
      });

      expect(renderedSql(queryRaw)).toContain(expected);
    },
  );

  it('alertOnly 覆盖 danger 与 warning 两档', async () => {
    const { prisma, queryRaw } = createPrisma();

    await queryInventoryProductPage(prisma, {
      ...PAGE_PARAMS,
      query: { alertOnly: true },
    });

    expect(renderedSql(queryRaw)).toContain('AND stock <= alert_threshold');
  });

  it('alertLevel 优先于 alertOnly，口径与 matchesInventoryFilters 一致', async () => {
    const { prisma, queryRaw } = createPrisma();

    await queryInventoryProductPage(prisma, {
      ...PAGE_PARAMS,
      query: { alertLevel: 'normal', alertOnly: true },
    });

    const sql = renderedSql(queryRaw);
    expect(sql).toContain('AND stock > alert_threshold');
    expect(sql).not.toContain('AND stock <= alert_threshold');
  });

  it('默认 alert 排序按 danger → warning → normal 分级，同级按库存升序', async () => {
    const { prisma, queryRaw } = createPrisma();

    await queryInventoryProductPage(prisma, PAGE_PARAMS);

    const sql = renderedSql(queryRaw);
    expect(sql).toContain('WHEN stock <= 0 THEN 0');
    expect(sql).toContain('WHEN stock <= alert_threshold THEN 1');
    expect(sql).toContain('ELSE 2');
    expect(sql).toContain('stock ASC');
  });

  const stockSortCases = [
    ['stock_asc', 'ORDER BY stock ASC, id ASC'],
    ['stock_desc', 'ORDER BY stock DESC, id ASC'],
  ] as const;

  it.each(stockSortCases)(
    'sortBy=%s 按库存排序并保留 id 稳定次序',
    async (sortBy, expected) => {
      const { prisma, queryRaw } = createPrisma();

      await queryInventoryProductPage(prisma, {
        ...PAGE_PARAMS,
        query: { sortBy },
      });

      expect(renderedSql(queryRaw)).toContain(expected);
    },
  );

  it('从窗口列取 total 并剥离该列，空结果 total 为 0', async () => {
    const withRows = createPrisma([
      { id: 1, name: '可乐', totalCount: 7 },
      { id: 2, name: '雪碧', totalCount: 7 },
    ]);
    const result = await queryInventoryProductPage(
      withRows.prisma,
      PAGE_PARAMS,
    );
    expect(result.total).toBe(7);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).not.toHaveProperty('totalCount');

    const empty = createPrisma();
    await expect(
      queryInventoryProductPage(empty.prisma, PAGE_PARAMS),
    ).resolves.toEqual({ items: [], total: 0 });
  });
});
