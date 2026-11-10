import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toNullableText } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildCategoryResponse } from './categories.mapper';
import {
  clearCategoryProducts,
  createCategoryRecord,
  deleteCategoryRecord,
  findCategoryById,
  findCategoryDuplicateByName,
  renameCategoryProducts,
  updateCategoryRecord,
} from './categories.query';
import { Prisma } from '@prisma/client';
import type {
  CategoryClearProductsInput,
  CategoryCreateInput,
  CategoryDuplicateQueryInput,
  CategoryRecord,
  CategoryRenameProductsInput,
  CategoryUpdateInput,
} from './categories.types';
import type {
  CategoryResponseDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

@Injectable()
export class CategoriesWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'goods:create',
      '无权操作该门店商品分类',
    );

    await this.ensureUniqueName(storeId, dto.name);

    try {
      const category = await this.prisma.$transaction(async (tx) => {
        const created = await createCategoryRecord(
          tx,
          this.toCreateInput(storeId, dto),
        );
        await this.ensureScanOrderingCategory(tx, storeId, created.name);
        return created;
      });

      return buildCategoryResponse(category);
    } catch (error: unknown) {
      // 并发创建时应用层查重可能同时放行，由数据库唯一约束兜底；统一转为 409，
      // 避免把 Prisma 原始异常泄漏成 500（与 ensureUniqueName 保持同一文案口径）。
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('分类名称已存在');
      }
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    categoryId: number,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.getCategoryOrThrow(categoryId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      category.storeId,
      'goods:update',
      '无权操作该门店商品分类',
    );

    const nextName = dto.name;
    const shouldRename = nextName && nextName !== category.name;

    if (shouldRename) {
      await this.ensureUniqueName(category.storeId, nextName, category.id);
    }

    const changes = this.toUpdateInput(dto, nextName);
    // 无字段变更时不开启事务、不触发一次空 UPDATE：Prisma 的空 update 仍会
    // 刷新 @updatedAt，既产生无谓写，又会让分类跳到列表首位并使列表缓存失效。
    if (Object.keys(changes).length === 0) {
      return buildCategoryResponse(category);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await updateCategoryRecord(tx, category.id, changes);

      if (shouldRename) {
        await renameCategoryProducts(
          tx,
          this.toRenameProductsInput(category, nextName),
        );
        await this.renameScanOrderingCategory(
          tx,
          category.storeId,
          category.name,
          nextName,
        );
      }

      return result;
    });

    return buildCategoryResponse(updated);
  }

  async remove(user: AuthenticatedUser, categoryId: number): Promise<void> {
    const category = await this.getCategoryOrThrow(categoryId);

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      category.storeId,
      'goods:delete',
      '无权删除该门店商品分类',
    );

    await this.prisma.$transaction(async (tx) => {
      await clearCategoryProducts(tx, this.toClearProductsInput(category));
      await deleteCategoryRecord(tx, category.id);
    });
  }

  private async ensureScanOrderingCategory(
    tx: Prisma.TransactionClient,
    storeId: number,
    name: string,
  ): Promise<void> {
    const existing = await tx.scanOrderingMenuCategory.findFirst({
      where: { storeId, name, deletedAt: null },
      select: { id: true },
    });
    if (existing) return;

    const lastCategory = await tx.scanOrderingMenuCategory.findFirst({
      where: { storeId, deletedAt: null },
      orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
      select: { sortOrder: true },
    });
    await tx.scanOrderingMenuCategory.create({
      data: {
        storeId,
        name,
        sortOrder: (lastCategory?.sortOrder ?? -1) + 1,
      },
    });
  }

  private async renameScanOrderingCategory(
    tx: Prisma.TransactionClient,
    storeId: number,
    previousName: string,
    nextName: string,
  ): Promise<void> {
    // 有效行上有 (storeId, name) 部分唯一约束，一次查询即可同时拿到
    // 源分类与目标分类，替代原先两次串行 findFirst，缩短事务持锁时间。
    const menuCategories = await tx.scanOrderingMenuCategory.findMany({
      where: {
        storeId,
        deletedAt: null,
        name: { in: [previousName, nextName] },
      },
      select: { id: true, name: true },
    });
    const sourceCategory = menuCategories.find(
      (category) => category.name === previousName,
    );
    const targetCategory = menuCategories.find(
      (category) => category.name === nextName,
    );

    if (!sourceCategory) {
      // 目标分类已存在时无需再走 ensureScanOrderingCategory 的查重
      if (targetCategory) return;
      await this.ensureScanOrderingCategory(tx, storeId, nextName);
      return;
    }

    if (targetCategory && targetCategory.id !== sourceCategory.id) {
      await tx.scanOrderingMenuProduct.updateMany({
        where: { storeId, categoryId: sourceCategory.id, deletedAt: null },
        data: { categoryId: targetCategory.id },
      });
      await tx.scanOrderingMenuCategory.update({
        where: { id: sourceCategory.id },
        data: { isActive: false, deletedAt: new Date() },
      });
      return;
    }

    await tx.scanOrderingMenuCategory.update({
      where: { id: sourceCategory.id },
      data: { name: nextName },
    });
  }

  private async getCategoryOrThrow(categoryId: number) {
    const category = await findCategoryById(this.prisma, categoryId);

    if (!category) {
      throw new NotFoundException('分类不存在');
    }

    return category;
  }

  private async ensureUniqueName(
    storeId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const existing = await findCategoryDuplicateByName(
      this.prisma,
      this.toDuplicateQueryInput(storeId, name, excludeId),
    );

    if (existing) {
      throw new ConflictException('分类名称已存在');
    }
  }

  private toCreateInput(
    storeId: number,
    dto: CreateCategoryDto,
  ): CategoryCreateInput {
    return {
      storeId,
      name: dto.name,
      icon: toNullableText(dto.icon) ?? null,
    };
  }

  private toUpdateInput(
    dto: UpdateCategoryDto,
    nextName?: string,
  ): CategoryUpdateInput {
    return {
      ...(nextName ? { name: nextName } : {}),
      ...(dto.icon !== undefined
        ? { icon: toNullableText(dto.icon) ?? null }
        : {}),
    };
  }

  private toDuplicateQueryInput(
    storeId: number,
    name: string,
    excludeId?: number,
  ): CategoryDuplicateQueryInput {
    return {
      storeId,
      name,
      excludeId,
    };
  }

  private toRenameProductsInput(
    category: CategoryRecord,
    name: string,
  ): CategoryRenameProductsInput {
    return {
      storeId: category.storeId,
      categoryId: category.id,
      name,
    };
  }

  private toClearProductsInput(
    category: CategoryRecord,
  ): CategoryClearProductsInput {
    return {
      storeId: category.storeId,
      categoryId: category.id,
    };
  }
}
