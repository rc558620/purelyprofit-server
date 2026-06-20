import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  ProductCategoryRecord,
  ProductCreateInput,
  ProductListQueryInput,
  ProductPageResult,
  ProductRecord,
  ProductStoreRecord,
  ProductUpdateInput,
} from './products.types';

const productSelect = {
  id: true,
  storeId: true,
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
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

function buildProductListWhere(
  storeId: number,
  query: ProductListQueryInput,
): Prisma.ProductWhereInput {
  return {
    storeId,
    ...(query.category ? { category: query.category } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.keyword
      ? {
          OR: [
            {
              name: { contains: query.keyword, mode: 'insensitive' as const },
            },
            {
              code: { contains: query.keyword, mode: 'insensitive' as const },
            },
          ],
        }
      : {}),
  };
}

export function resolveProductOrderBy(
  sortBy?: ProductListQueryInput['sortBy'],
) {
  switch (sortBy) {
    case 'name':
      return [{ name: 'asc' as const }, { id: 'desc' as const }];
    case 'price_asc':
      return [{ price: 'asc' as const }, { id: 'desc' as const }];
    case 'price_desc':
      return [{ price: 'desc' as const }, { id: 'desc' as const }];
    case 'profit_desc':
      return [{ profit: 'desc' as const }, { id: 'desc' as const }];
    case 'createdAt':
    default:
      return [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
  }
}

export async function queryProductPage(
  prisma: PrismaService,
  params: {
    storeId: number;
    query: ProductListQueryInput;
    skip: number;
    take: number;
  },
): Promise<ProductPageResult> {
  const where = buildProductListWhere(params.storeId, params.query);
  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: resolveProductOrderBy(params.query.sortBy),
      skip: params.skip,
      take: params.take,
      select: productSelect,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items,
    total,
  };
}

export async function findProductById(
  prisma: PrismaService,
  productId: number,
): Promise<ProductRecord | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: productSelect,
  });
}

export async function findProductStore(
  prisma: PrismaService,
  productId: number,
): Promise<ProductStoreRecord | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      storeId: true,
    },
  });
}

export async function findProductCategoryByName(
  prisma: PrismaService,
  storeId: number,
  name: string,
): Promise<ProductCategoryRecord | null> {
  return prisma.productCategory.findFirst({
    where: {
      storeId,
      name,
    },
    select: {
      id: true,
    },
  });
}

export async function createProductCategory(
  prisma: PrismaService,
  storeId: number,
  name: string,
): Promise<ProductCategoryRecord> {
  return prisma.productCategory.create({
    data: {
      storeId,
      name,
    },
    select: {
      id: true,
    },
  });
}

export async function findProductCodeConflict(
  prisma: PrismaService,
  params: {
    storeId: number;
    code: string;
    excludeId?: number;
  },
): Promise<{ id: number } | null> {
  return prisma.product.findFirst({
    where: {
      storeId: params.storeId,
      code: params.code,
      ...(params.excludeId !== undefined
        ? { id: { not: params.excludeId } }
        : {}),
    },
    select: {
      id: true,
    },
  });
}

export async function createProductRecord(
  prisma: PrismaService,
  data: ProductCreateInput,
): Promise<ProductRecord> {
  return prisma.product.create({
    data,
    select: productSelect,
  });
}

export async function updateProductRecord(
  prisma: PrismaService,
  productId: number,
  data: ProductUpdateInput,
): Promise<ProductRecord> {
  return prisma.product.update({
    where: { id: productId },
    data,
    select: productSelect,
  });
}

export async function deleteProductRecord(
  prisma: PrismaService,
  productId: number,
): Promise<void> {
  try {
    await prisma.product.delete({
      where: { id: productId },
    });
  } catch (error: unknown) {
    // P2025: 记录不存在（并发删除场景），静默处理
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: string }).code === 'P2025'
    ) {
      return;
    }
    throw error;
  }
}
