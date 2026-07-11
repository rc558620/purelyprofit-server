import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  InventoryAdjustmentPageResult,
  InventoryAdjustmentsListQueryInput,
  InventoryProductListQueryInput,
  InventoryProductPageResult,
  InventoryProductStoreRecord,
  InventoryStatsRow,
  InventoryThresholdUpdateRecord,
} from './inventory.types';

export async function queryInventoryProducts(
  prisma: PrismaService,
  storeId: number,
  query: InventoryProductListQueryInput,
  pagination?: { skip: number; take: number },
): Promise<InventoryProductPageResult> {
  /* BUG-7: 将 alertLevel 过滤下推到数据库层，减少内存过滤 */
  const alertWhere = buildAlertWhereCondition(query.alertLevel);
  const where: Prisma.ProductWhereInput = {
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

export async function queryInventoryStatsRows(
  prisma: PrismaService,
  storeId: number,
): Promise<InventoryStatsRow[]> {
  return prisma.product.findMany({
    where: {
      storeId,
      deletedAt: null,
      isActive: true,
    },
    select: {
      stock: true,
      alertThreshold: true,
      costPrice: true,
    },
  });
}
