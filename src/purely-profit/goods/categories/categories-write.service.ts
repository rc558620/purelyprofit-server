import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toOptionalText } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildCategoryResponse } from './categories.mapper';
import {
  createCategoryRecord,
  deleteCategoryRecord,
  findCategoryById,
  findCategoryDuplicateByName,
  renameCategoryProducts,
  updateCategoryRecord,
} from './categories.query';
import type {
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
    const name = dto.name.trim();

    await this.ensureUniqueName(storeId, name);

    const category = await createCategoryRecord(
      this.prisma,
      this.toCreateInput(storeId, name, dto),
    );

    return buildCategoryResponse(category);
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

    const nextName = dto.name?.trim();
    if (nextName && nextName !== category.name) {
      await this.ensureUniqueName(category.storeId, nextName, category.id);
    }

    const updated = await updateCategoryRecord(
      this.prisma,
      category.id,
      this.toUpdateInput(dto, nextName),
    );

    if (nextName && nextName !== category.name) {
      await renameCategoryProducts(
        this.prisma,
        this.toRenameProductsInput(category, nextName),
      );
    }

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

    await deleteCategoryRecord(this.prisma, category.id);
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
    name: string,
    dto: CreateCategoryDto,
  ): CategoryCreateInput {
    return {
      storeId,
      name,
      icon: toOptionalText(dto.icon) ?? null,
    };
  }

  private toUpdateInput(
    dto: UpdateCategoryDto,
    nextName?: string,
  ): CategoryUpdateInput {
    return {
      ...(nextName ? { name: nextName } : {}),
      ...(dto.icon !== undefined
        ? { icon: toOptionalText(dto.icon) ?? null }
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
}
