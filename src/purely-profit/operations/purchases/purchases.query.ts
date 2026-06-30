import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  PURCHASE_ORDER_WITH_ITEMS_INCLUDE,
  type PreparedPurchaseItem,
  type PurchaseOrderWithItems,
  type PurchasePreviousAggregate,
  type PurchaseProductRecord,
  type PurchaseStatsAggregate,
} from './purchases.types';

export async function queryPurchaseOrders(
  prisma: PrismaService,
  params: {
    where: Prisma.PurchaseOrderWhereInput;
    skip: number;
    take: number;
  },
): Promise<PurchaseOrderWithItems[]> {
  return prisma.purchaseOrder.findMany({
    where: params.where,
    include: PURCHASE_ORDER_WITH_ITEMS_INCLUDE,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    skip: params.skip,
    take: params.take,
  });
}

export async function countPurchaseOrders(
  prisma: PrismaService,
  where: Prisma.PurchaseOrderWhereInput,
): Promise<number> {
  return prisma.purchaseOrder.count({ where });
}

export async function countPurchaseSuppliers(
  prisma: PrismaService,
  storeId: number,
  where?: Prisma.PurchaseOrderWhereInput,
): Promise<number> {
  if (!where) {
    return prisma.supplier.count({ where: { storeId } });
  }

  const result = await prisma.purchaseOrder.findMany({
    where,
    select: { supplierId: true },
    distinct: ['supplierId'],
  });
  // supplierId 为 null 表示手输供应商名，不计入供应商数
  const validSupplierIds = result.filter((r) => r.supplierId !== null);
  return validSupplierIds.length;
}

export async function aggregatePurchaseOrders(
  prisma: PrismaService,
  where: Prisma.PurchaseOrderWhereInput,
): Promise<PurchaseStatsAggregate> {
  return prisma.purchaseOrder.aggregate({
    where,
    _count: { id: true },
    _sum: { totalAmount: true },
  });
}

export async function aggregatePreviousPurchaseOrders(
  prisma: PrismaService,
  params: {
    storeId: number;
    previousRange?: { gte: Date; lte: Date };
  },
): Promise<PurchasePreviousAggregate> {
  if (!params.previousRange) {
    return { _sum: { totalAmount: null } };
  }

  return prisma.purchaseOrder.aggregate({
    where: {
      storeId: params.storeId,
      date: params.previousRange,
    },
    _sum: { totalAmount: true },
  });
}

export async function findPurchaseSupplier(
  prisma: PrismaService,
  params: { storeId: number; supplierId: number },
): Promise<{ id: number; name: string } | null> {
  return prisma.supplier.findFirst({
    where: {
      id: params.supplierId,
      storeId: params.storeId,
    },
    select: {
      id: true,
      name: true,
    },
  });
}

export async function queryPurchaseProducts(
  prisma: PrismaService,
  params: { storeId: number; productIds: number[] },
): Promise<PurchaseProductRecord[]> {
  if (params.productIds.length === 0) {
    return [];
  }

  return prisma.product.findMany({
    where: {
      storeId: params.storeId,
      deletedAt: null,
      id: { in: params.productIds },
    },
    select: {
      id: true,
      name: true,
      unit: true,
    },
  });
}

export async function createPurchaseOrderEntity(
  transaction: Prisma.TransactionClient,
  params: {
    storeId: number;
    supplierId: number | null;
    supplierName: string | null;
    operatorStaffId: number | null;
    totalAmount: number;
    date: Date;
    note: string | null;
    items: PreparedPurchaseItem[];
  },
): Promise<PurchaseOrderWithItems> {
  return transaction.purchaseOrder.create({
    data: {
      storeId: params.storeId,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      operatorStaffId: params.operatorStaffId,
      totalAmount: params.totalAmount,
      date: params.date,
      note: params.note,
      items: {
        create: params.items.map((item) => ({
          storeId: params.storeId,
          productId: item.productId,
          productName: item.productName,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
        })),
      },
    },
    include: PURCHASE_ORDER_WITH_ITEMS_INCLUDE,
  });
}

export async function findPurchaseOrderAccessRecord(
  prisma: PrismaService,
  purchaseId: number,
): Promise<{ id: number; storeId: number } | null> {
  return prisma.purchaseOrder.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      storeId: true,
    },
  });
}

export async function deletePurchaseOrderEntity(
  prisma: PrismaService | Prisma.TransactionClient,
  purchaseId: number,
): Promise<void> {
  await prisma.purchaseOrder.delete({
    where: { id: purchaseId },
  });
}
