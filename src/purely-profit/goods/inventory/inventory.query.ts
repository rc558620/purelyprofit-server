import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  InventoryAdjustmentPageResult,
  InventoryAdjustmentsListQueryInput,
  InventoryProductListQueryInput,
  InventoryProductPageResult,
  InventoryProductRecord,
  InventoryProductStoreRecord,
  InventoryReportRow,
  InventoryStatsAggregate,
  InventoryThresholdUpdateRecord,
} from './inventory.types';

/** 库存商品列表的公共过滤条件：门店 + 在售 + 分类 + 关键字 + 可下推的预警级别 */
function buildInventoryProductWhere(
  storeId: number,
  query: InventoryProductListQueryInput,
): Prisma.ProductWhereInput {
  /* BUG-7: 将 alertLevel 过滤下推到数据库层，减少内存过滤 */
  const alertWhere = buildAlertWhereCondition(query.alertLevel);
  return {
    storeId,
    deletedAt: null,
    isActive: true,
    ...(query.category ? { category: query.category } : {}),
    ...(query.keyword
      ? {
          OR: [
            {
              name: {
                contains: query.keyword,
                mode: 'insensitive' as const,
              },
            },
            {
              code: {
                contains: query.keyword,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {}),
    ...alertWhere,
  };
}

/** 报表导出专用字段：库存报表与 CSV 只用到这 4 列，不必拉整行 */
const inventoryReportRowSelect = {
  name: true,
  category: true,
  stock: true,
  alertThreshold: true,
} as const;

/**
 * 库存报表的轻量查询：与 queryInventoryProducts 同一过滤口径，只取报表实际用到的列。
 *
 * CSV 导出原本走 getReport，会把整行（含价格、图片、时间戳）全量拉出再只取 5 列；
 * 大店导出时这部分行传输与内存占用都是纯浪费。
 */
export async function queryInventoryReportRows(
  prisma: PrismaService,
  storeId: number,
  query: InventoryProductListQueryInput,
): Promise<InventoryReportRow[]> {
  return prisma.product.findMany({
    where: buildInventoryProductWhere(storeId, query),
    select: inventoryReportRowSelect,
  });
}

export async function queryInventoryProducts(
  prisma: PrismaService,
  storeId: number,
  query: InventoryProductListQueryInput,
  pagination?: { skip: number; take: number },
): Promise<InventoryProductPageResult> {
  const where = buildInventoryProductWhere(storeId, query);

  /*
   * D4/D8 修复：
   * 有分页参数时下推 skip/take 到数据库层，并并行执行 COUNT；
   * 无分页参数时返回全量结果，跳过冗余 COUNT 查询。
   */
  if (pagination) {
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        select: productSelect,
      }),
      prisma.product.count({ where }),
    ]);
    return { items, total };
  }

  const items = await prisma.product.findMany({
    where,
    select: productSelect,
  });
  return { items };
}

const productSelect = {
  id: true,
  name: true,
  category: true,
  code: true,
  price: true,
  profit: true,
  costPrice: true,
  unit: true,
  stock: true,
  alertThreshold: true,
  image: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * BUG-7: 根据 alertLevel 和 alertOnly 参数构建 Prisma where 条件，
 * 将预警级别过滤下推到数据库层，避免全量加载到内存后再过滤。
 *
 * 注意：Prisma 不支持 stock <= alertThreshold 这种跨字段比较，
 * 所以 warning 级别无法在数据库层完整过滤，仍需 domain 层 matchesInventoryFilters 补充。
 * danger 级别（stock <= 0）可以精确过滤。
 */
function buildAlertWhereCondition(
  alertLevel?: InventoryProductListQueryInput['alertLevel'],
  // alertOnly 涉及 stock <= alertThreshold 的跨字段比较，Prisma 无法表达，由 domain 层过滤
): Prisma.ProductWhereInput {
  if (alertLevel === 'danger') {
    return { stock: { lte: 0 } };
  }

  /* warning 和 alertOnly 涉及 stock <= alertThreshold 的跨字段比较，Prisma 无法表达，留空由 domain 层过滤 */
  return {};
}

export async function queryInventoryAdjustmentPage(
  prisma: PrismaService,
  params: {
    storeId: number;
    query: InventoryAdjustmentsListQueryInput;
    skip: number;
    take: number;
  },
): Promise<InventoryAdjustmentPageResult> {
  const where: Prisma.InventoryAdjustmentLogWhereInput = {
    storeId: params.storeId,
    ...(params.query.productId ? { productId: params.query.productId } : {}),
    ...(params.query.adjustType ? { adjustType: params.query.adjustType } : {}),
    ...(params.query.keyword
      ? {
          productName: {
            contains: params.query.keyword,
            mode: 'insensitive' as const,
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.inventoryAdjustmentLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: params.skip,
      take: params.take,
      select: {
        id: true,
        productId: true,
        productName: true,
        beforeStock: true,
        afterStock: true,
        delta: true,
        adjustType: true,
        note: true,
        purchaseOrderId: true,
        createdAt: true,
      },
    }),
    prisma.inventoryAdjustmentLog.count({ where }),
  ]);

  return {
    items,
    total,
  };
}

export async function findInventoryProductStore(
  prisma: PrismaService,
  productId: number,
): Promise<InventoryProductStoreRecord | null> {
  /*
   * BUG-3 修复：加 deletedAt: null 过滤软删除商品，
   * 避免已删除商品的阈值被静默更新。
   */
  return prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      storeId: true,
      isActive: true,
    },
  });
}

export async function updateInventoryAlertThresholdRecord(
  prisma: PrismaService,
  productId: number,
  threshold: number,
): Promise<InventoryThresholdUpdateRecord> {
  return prisma.product.update({
    where: { id: productId },
    data: {
      alertThreshold: threshold,
    },
    select: {
      id: true,
      alertThreshold: true,
      updatedAt: true,
    },
  });
}

/** 库存概况聚合行：$queryRaw 下 COUNT/SUM 为 bigint，需显式转 number */
interface InventoryStatsAggregateRow {
  totalSkuCount: bigint | number;
  dangerCount: bigint | number;
  warningCount: bigint | number;
  normalCount: bigint | number;
  totalStockValueCents: bigint | number | null;
}

/** raw 查询返回的库存商品行：列名与 products 表一致，仅做 snake_case → camelCase 别名 */
interface InventoryAlertProductRow {
  id: number;
  name: string;
  category: string;
  code: string;
  price: number;
  profit: number;
  costPrice: number | null;
  unit: string;
  stock: number;
  alertThreshold: number;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 转义 ILIKE 通配符，与 Prisma `contains` 的转义口径一致（反斜杠为转义符）。
 *
 * 不转义的话，搜索「50%」「A_B」会被当成通配符，与分页接口的 Prisma 查询行为不一致。
 */
function escapeLikePattern(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 预警商品查询：把「stock <= alert_threshold」这类跨字段比较下推到数据库。
 *
 * Prisma 无法表达列与列的比较，原来只能把全店在售商品拉回内存再过滤，
 * SKU 越多浪费越大；这里用 raw SQL 直接过滤，只返回预警行。
 *
 * 口径与 inventory.domain 的 resolveInventoryAlertLevel 对齐：
 * - alertOnly：stock <= alert_threshold（含 stock <= 0 的 danger 行）
 * - warning：0 < stock <= alert_threshold
 * danger 档（stock <= 0）Prisma 已能下推，仍走 queryInventoryProducts。
 */
export async function queryInventoryAlertProducts(
  prisma: PrismaService,
  params: {
    storeId: number;
    keyword?: string;
    category?: string;
    mode: 'alertOnly' | 'warning';
  },
): Promise<InventoryProductRecord[]> {
  const keyword = params.keyword?.trim();
  const keywordPattern = keyword ? `%${escapeLikePattern(keyword)}%` : null;
  // alertOnly 要带上 stock <= 0 的 danger 行；warning 档要求库存尚未耗尽
  const includeDanger = params.mode === 'alertOnly';

  return prisma.$queryRaw<InventoryAlertProductRow[]>`
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
      updated_at AS "updatedAt"
    FROM products
    WHERE store_id = ${params.storeId}
      AND deleted_at IS NULL
      AND is_active = true
      AND stock <= alert_threshold
      AND (${includeDanger}::boolean OR stock > 0)
      AND (${params.category ?? null}::text IS NULL OR category = ${params.category ?? null})
      AND (
        ${keywordPattern}::text IS NULL
        OR name ILIKE ${keywordPattern} ESCAPE '\'
        OR code ILIKE ${keywordPattern} ESCAPE '\'
      )
  `;
}

/**
 * 库存概况统计：一次聚合算完全部指标，返回单行。
 *
 * 原实现把全店在售商品的 stock / alertThreshold / costPrice 全部拉回内存再数一遍，
 * 行传输与序列化随 SKU 数线性增长；这里连预警分级一起在库内算完——
 * 分级口径与 inventory.domain 的 resolveInventoryAlertLevel 严格一致
 * （danger: stock <= 0；warning: 0 < stock <= 阈值；其余 normal），
 * 金额沿用 buildInventoryStats 的整数「分」口径，避免浮点累加误差。
 */
export async function queryInventoryStatsAggregate(
  prisma: PrismaService,
  storeId: number,
): Promise<InventoryStatsAggregate> {
  const rows = await prisma.$queryRaw<InventoryStatsAggregateRow[]>`
    SELECT
      COUNT(*)::int AS "totalSkuCount",
      COUNT(*) FILTER (WHERE stock <= 0)::int AS "dangerCount",
      COUNT(*) FILTER (WHERE stock > 0 AND stock <= alert_threshold)::int AS "warningCount",
      COUNT(*) FILTER (WHERE stock > alert_threshold)::int AS "normalCount",
      COALESCE(SUM(stock::bigint * cost_price), 0)::bigint AS "totalStockValueCents"
    FROM products
    WHERE store_id = ${storeId}
      AND deleted_at IS NULL
      AND is_active = true
  `;

  const row = rows[0];
  if (!row) {
    return {
      totalSkuCount: 0,
      dangerCount: 0,
      warningCount: 0,
      normalCount: 0,
      totalStockValueCents: 0,
    };
  }

  return {
    totalSkuCount: Number(row.totalSkuCount),
    dangerCount: Number(row.dangerCount),
    warningCount: Number(row.warningCount),
    normalCount: Number(row.normalCount),
    totalStockValueCents: Number(row.totalStockValueCents ?? 0),
  };
}
