import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toOptionalText, toTimestampMs } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  type CategoryResponseDto,
  type CreateCategoryDto,
  type ListCategoriesQueryDto,
  type UpdateCategoryDto,
} from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListCategoriesQueryDto,
  ): Promise<CategoryResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'goods:view',
      '无权查看该门店商品分类',
    );

    if (storeId === null) {
      return [];
    }

    const items = await this.prisma.productCategory.findMany({
      where: {
        storeId,
        ...(query.keyword
          ? {
              name: {
                contains: query.keyword,
                mode: 'insensitive',
              },
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    return items.map((item) => this.toCategoryResponse(item));
  }

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

    const existing = await this.prisma.productCategory.findFirst({
      where: {
        storeId,
        name,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException('分类名称已存在');
    }

    const category = await this.prisma.productCategory.create({
      data: {
        storeId,
        name,
        icon: toOptionalText(dto.icon) ?? null,
      },
    });

    return this.toCategoryResponse(category);
  }

  async update(
    user: AuthenticatedUser,
    categoryId: number,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.prisma.productCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      throw new NotFoundException('分类不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      category.storeId,
      'goods:update',
      '无权操作该门店商品分类',
    );

    const nextName = dto.name?.trim();
    if (nextName && nextName !== category.name) {
      const duplicate = await this.prisma.productCategory.findFirst({
        where: {
          storeId: category.storeId,
          name: nextName,
          id: {
            not: category.id,
          },
        },
        select: {
          id: true,
        },
      });

      if (duplicate) {
        throw new ConflictException('分类名称已存在');
      }
    }

    const updated = await this.prisma.productCategory.update({
      where: { id: category.id },
      data: {
        ...(nextName ? { name: nextName } : {}),
        ...(dto.icon !== undefined
          ? { icon: toOptionalText(dto.icon) ?? null }
          : {}),
      },
    });

    if (nextName && nextName !== category.name) {
      await this.prisma.product.updateMany({
        where: {
          storeId: category.storeId,
          categoryId: category.id,
        },
        data: {
          category: nextName,
        },
      });
    }

    return this.toCategoryResponse(updated);
  }

  async remove(user: AuthenticatedUser, categoryId: number): Promise<void> {
    const category = await this.prisma.productCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      throw new NotFoundException('分类不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      category.storeId,
      'goods:delete',
      '无权删除该门店商品分类',
    );

    await this.prisma.productCategory.delete({
      where: { id: category.id },
    });
  }

  private toCategoryResponse(category: {
    id: number;
    name: string;
    icon: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CategoryResponseDto {
    return {
      id: String(category.id),
      name: category.name,
      ...(category.icon ? { icon: category.icon } : {}),
      createdAt: toTimestampMs(category.createdAt),
      updatedAt: toTimestampMs(category.updatedAt),
    };
  }
}
