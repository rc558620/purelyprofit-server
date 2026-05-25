import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CategoriesReadService } from './categories-read.service';
import { CategoriesWriteService } from './categories-write.service';
import type {
  CategoryResponseDto,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly categoriesReadService: CategoriesReadService,
    private readonly categoriesWriteService: CategoriesWriteService,
  ) {}

  list(
    user: AuthenticatedUser,
    query: ListCategoriesQueryDto,
  ): Promise<CategoryResponseDto[]> {
    return this.categoriesReadService.list(user, query);
  }

  create(
    user: AuthenticatedUser,
    dto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoriesWriteService.create(user, dto);
  }

  update(
    user: AuthenticatedUser,
    categoryId: number,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoriesWriteService.update(user, categoryId, dto);
  }

  remove(user: AuthenticatedUser, categoryId: number): Promise<void> {
    return this.categoriesWriteService.remove(user, categoryId);
  }
}
