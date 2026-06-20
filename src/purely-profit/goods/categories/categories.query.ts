import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  CategoryClearProductsInput,
  CategoryCreateInput,
  CategoryDuplicateQueryInput,
  CategoryIdRecord,
  CategoryListQueryInput,
  CategoryRecord,
  CategoryRenameProductsInput,
  CategoryUpdateInput,
} from './categories.types';

export const CATEGORY_SELECT = {
  id: true,
  storeId: true,
  name: true,
  icon: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductCategorySelect;

export const CATEGORY_ID_SELECT = {
  id: true,
} satisfies Prisma.ProductCategorySelect;

export async function listCategoryRecords(
  prisma: PrismaService,
  params: CategoryListQueryInput,
): Promise<CategoryRecord[]> {
  return prisma.productCategory.findMany({
    where: {
      storeId: params.storeId,
      ...(params.keyword
        ? {
            name: {
              contains: params.keyword,
              mode: 'insensitive',
            },
          }
        : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: CATEGORY_SELECT,
  });
}

export async function findCategoryById(
  prisma: PrismaService,
  categoryId: number,
): Promise<CategoryRecord | null> {
  return prisma.productCategory.findUnique({
    where: { id: categoryId },
    select: CATEGORY_SELECT,
  });
}

export async function findCategoryDuplicateByName(
  prisma: PrismaService,
  params: CategoryDuplicateQueryInput,
): Promise<CategoryIdRecord | null> {
  return prisma.productCategory.findFirst({
    where: {
      storeId: params.storeId,
      name: {
        equals: params.name,
        mode: 'insensitive',
      },
      ...(params.excludeId !== undefined
        ? { id: { not: params.excludeId } }
        : {}),
    },
    select: CATEGORY_ID_SELECT,
  });
}

export async function createCategoryRecord(
  prisma: PrismaService,
  data: CategoryCreateInput,
): Promise<CategoryRecord> {
  return prisma.productCategory.create({
    data,
    select: CATEGORY_SELECT,
  });
}

type PrismaClientOrTransaction = PrismaService | Prisma.TransactionClient;

export async function updateCategoryRecord(
  prisma: PrismaClientOrTransaction,
  categoryId: number,
  data: CategoryUpdateInput,
): Promise<CategoryRecord> {
  return prisma.productCategory.update({
    where: { id: categoryId },
    data,
    select: CATEGORY_SELECT,
  });
}

export async function renameCategoryProducts(
  prisma: PrismaClientOrTransaction,
  params: CategoryRenameProductsInput,
): Promise<void> {
  await prisma.product.updateMany({
    where: {
      storeId: params.storeId,
      categoryId: params.categoryId,
    },
    data: {
      category: params.name,
    },
  });
}

export async function clearCategoryProducts(
  prisma: PrismaClientOrTransaction,
  params: CategoryClearProductsInput,
): Promise<void> {
  await prisma.product.updateMany({
    where: {
      storeId: params.storeId,
      categoryId: params.categoryId,
    },
    data: {
      category: '',
      categoryId: null,
    },
  });
}

export async function deleteCategoryRecord(
  prisma: PrismaClientOrTransaction,
  categoryId: number,
): Promise<void> {
  await prisma.productCategory.delete({
    where: { id: categoryId },
  });
}
