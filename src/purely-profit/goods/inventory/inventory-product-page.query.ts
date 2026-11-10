import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  InventoryProductListQueryInput,
  InventoryProductPageResult,
  InventoryProductRecord,
} from './inventory.types';

/** raw 查询行：商品行 + 窗口函数算出的筛选后总数 */
type InventoryProductPageRow = InventoryProductRecord & { totalCount: number };

export interface InventoryProductPageParams {
  storeId: number;
  query: InventoryProductListQueryInput;
  skip: number;
  take: number;
}

/**
 * 转义 ILIKE 通配符，与 Prisma `contains` 的转义口径一致（反斜杠为转义符）。
 * 不转义的话，搜索「50%」「A_B」会被当成通配符。
 */
function escapeLikePattern(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 预警筛选下推：口径与 inventory.domain.matchesInventoryFilters 严格一致
 * （alertLevel 优先于 alertOnly；danger stock<=0；warning 0<stock<=阈值；
 * normal stock>阈值；alertOnly stock<=阈值 且含 danger）。
 * Prisma 无法表达 stock 与 alert_threshold 的跨字段比较，故用 raw SQL 片段。
 */
function buildAlertFilter(query: InventoryProductListQueryInput): Prisma.Sql {
  if (query.alertLevel === 'danger') {
    return Prisma.sql`AND stock <= 0`;
  }
  if (query.alertLevel === 'warning') {
    return Prisma.sql`AND stock > 0 AND stock <= alert_threshold`;
  }
  if (query.alertLevel === 'normal') {
    return Prisma.sql`AND stock > alert_threshold`;
  }
  if (query.alertOnly) {
    return Prisma.sql`AND stock <= alert_threshold`;
  }
  return Prisma.empty;
}

/**
 * 排序下推：口径与 inventory.domain.sortInventoryProducts 严格一致，
 * id 作为末级 tiebreak 保证分页稳定（原先分页 findMany 无 orderBy，
 * 跨页可能重复或遗漏）。
 *
 * sortBy=name 不走这里：domain 用 localeCompare('zh-CN') 拼音序，
 * PG 默认 collation 是码点序，下推会改变用户可见顺序，由 service 保留内存路径。
 */
function buildOrderByClause(
  sortBy: InventoryProductListQueryInput['sortBy'],
): Prisma.Sql {
  switch (sortBy) {
    case 'stock_asc':
      return Prisma.sql`ORDER BY stock ASC, id ASC`;
    case 'stock_desc':
      return Prisma.sql`ORDER BY stock DESC, id ASC`;
    case 'alert':
    default:
      return Prisma.sql`ORDER BY
        CASE
          WHEN stock <= 0 THEN 0
          WHEN stock <= alert_threshold THEN 1
          ELSE 2
        END ASC,
        stock ASC,
        id ASC`;
  }
}

/**
 * 库存商品分页：筛选 / 排序 / 总数 / LIMIT 全部在库内一次完成。
 *
 * 取代原先两条路径的缺陷：
 * - 普通分支 Prisma findMany 无 orderBy，且 count 与 findMany 两次扫描；
 * - 预警分支 raw SQL 无 LIMIT，全量拉回后内存 sort + slice。
 * 现在只回传当前页 + COUNT(*) OVER() 算出的总数，一次往返。
 */
export async function queryInventoryProductPage(
  prisma: PrismaService,
  params: InventoryProductPageParams,
): Promise<Required<InventoryProductPageResult>> {
  const { storeId, query, skip, take } = params;
  const keyword = query.keyword?.trim();
  const keywordPattern = keyword ? `%${escapeLikePattern(keyword)}%` : null;
  const category = query.category ?? null;
  const alertFilter = buildAlertFilter(query);
  const orderByClause = buildOrderByClause(query.sortBy);

  const rows = await prisma.$queryRaw<InventoryProductPageRow[]>`
    SELECT
      id,
      name,
      category,
      code,
      price,
      profit,
      cost_price AS "costPrice",
      unit,
      stock,
      alert_threshold AS "alertThreshold",
      image,
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      COUNT(*) OVER()::int AS "totalCount"
    FROM products
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND is_active = true
      AND (${category}::text IS NULL OR category = ${category})
      AND (
        ${keywordPattern}::text IS NULL
        OR name ILIKE ${keywordPattern} ESCAPE '\\'
        OR code ILIKE ${keywordPattern} ESCAPE '\\'
      )
      ${alertFilter}
    ${orderByClause}
    LIMIT ${take} OFFSET ${skip}
  `;

  return {
    items: rows.map(({ totalCount: _totalCount, ...product }) => product),
    total: rows[0]?.totalCount ?? 0,
  };
}
