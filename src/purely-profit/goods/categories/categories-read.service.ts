import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildCategoryResponse } from './categories.mapper';
import { listCategoryRecords } from './categories.query';
import type { CategoryListQueryInput } from './categories.types';
import type {
  CategoryResponseDto,
  ListCategoriesQueryDto,
} from './dto/category.dto';

@Injectable()
export class CategoriesReadService {
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

    const items = await listCategoryRecords(
      this.prisma,
      this.toListQueryInput(storeId, query),
    );

    return items.map(buildCategoryResponse);
  }

  private toListQueryInput(
    storeId: number,
    query: ListCategoriesQueryDto,
  ): CategoryListQueryInput {
    return {
      storeId,
      keyword: query.keyword,
    };
  }
}
