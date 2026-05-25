import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  InventoryAdjustmentPageResult,
  InventoryAdjustmentsListQueryInput,
  InventoryProductListQueryInput,
  InventoryProductRecord,
  InventoryProductStoreRecord,
  InventoryStatsRow,
  InventoryThresholdUpdateRecord,
} from './inventory.types';

export async function queryInventoryProducts(
  prisma: PrismaService,
  storeId: number,
  query: InventoryProductListQueryInput,
): Promise<InventoryProductRecord[]> {
  return prisma.product.findMany({
    where: {
      storeId,
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
    },
    select: {
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
    },
  });
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
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      storeId: true,
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
      isActive: true,
    },
    select: {
      stock: true,
      alertThreshold: true,
      costPrice: true,
    },
  });
}
