import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  InventoryAdjustmentPageResult,
  InventoryAdjustmentsListQueryInput,
  InventoryProductListQueryInput,
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

/**
 * 全量商品查询：供不传分页参数的列表、JSON 报表与 name 排序兼容路径使用。
 * 分页场景已改走 queryInventoryProductPage（库内筛选 + 排序 + COUNT + LIMIT）。
 */
export async function queryInventoryProducts(
  prisma: PrismaService,
  storeId: number,
  query: InventoryProductListQueryInput,
): Promise<{ items: InventoryProductRecord[] }> {
  const items = await prisma.product.findMany({
    where: buildInventoryProductWhere(storeId, query),
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
