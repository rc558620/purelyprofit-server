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

/**
 * 分类列表缓存版本：一次轻量聚合代替「查全表算内容哈希」。
 *
 * 覆盖全部写路径，因此无需在任何写 service 里注册失效：
 * - 新建 / 改名 / 改图标 → MAX(updated_at) 变化（@updatedAt 自动维护）；
 * - 新建 → MAX(id) 变化（兜住同一毫秒内的删除 + 新建）；
 * - 软删除 → COUNT(*) 变化（deleteCategoryRecord 走 update，同样刷新 updatedAt）。
 * 商品写路径的 ensureProductCategory 隐式建分类也落入以上变化。
 *
 * 边界：同一毫秒内对同一行连续两次 update 可能得到相同版本串，由 30s TTL
 * 兜底；分类是低频写配置数据，实际重叠窗口极小。
 *
 * 查询条件匹配 [storeId, updatedAt] WHERE deleted_at IS NULL 部分索引，
 * 档 B 表规模下为一次索引扫描，<1ms。
 */
export async function findCategoryListVersion(
  prisma: PrismaService,
  storeId: number,
): Promise<string> {
  const summary = await prisma.productCategory.aggregate({
    where: { storeId, deletedAt: null },
    _max: { updatedAt: true, id: true },
    _count: { _all: true },
  });

  return [
    summary._max.updatedAt?.getTime() ?? 0,
    summary._max.id ?? 0,
    summary._count._all,
  ].join('-');
}

export async function listCategoryRecords(
  prisma: PrismaService,
  params: CategoryListQueryInput,
): Promise<CategoryRecord[]> {
  return prisma.productCategory.findMany({
    where: {
      storeId: params.storeId,
      deletedAt: null,
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
  // 软删除分类不得再被 update / remove 命中；findUnique 无法附加过滤条件，
  // 这里用带 deletedAt 的 findFirst，仍走主键索引。
  return prisma.productCategory.findFirst({
    where: { id: categoryId, deletedAt: null },
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
      deletedAt: null,
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
  prisma: PrismaService | Prisma.TransactionClient,
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
      // 软删除商品对所有读路径不可见且无恢复入口，同步其冗余名称毫无收益，
      // 跳过可少写 N 行、少刷 @updatedAt，并避免维护 category 上的 btree / GIN 索引。
      deletedAt: null,
      // 幂等重试或历史已同步的行无需再写一次
      category: { not: params.name },
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
  // 软删除：更新 deletedAt 字段而非物理删除
  await prisma.productCategory.update({
    where: { id: categoryId },
    data: { deletedAt: new Date() },
  });
}
