import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  CalculateTimingPriceDto,
  CalculateTimingPriceResponseDto,
  MarketingProductCategoriesResponseDto,
  MarketingProductCategoryDto,
  MarketingProductDto,
  MarketingProductsResponseDto,
} from './dto/marketing-product.response.dto';
import type {
  CreateMarketingProductDto,
  UpdateMarketingProductDto,
} from './dto/marketing-product.dto';
import type {
  CreateMarketingProductCategoryDto,
  UpdateMarketingProductCategoryDto,
} from './dto/marketing-product-category.dto';
import type { ListMarketingProductsQueryDto } from './dto/marketing-product-query.dto';
import type { ToggleMarketingProductDto } from './dto/marketing-product-toggle.dto';
import { MarketingProductCategoriesService } from './marketing-product-categories.service';
import { MarketingProductsService } from './marketing-products.service';

@Injectable()
export class MarketingProductsFacadeService {
  constructor(
    private readonly marketingProductCategoriesService: MarketingProductCategoriesService,
    private readonly marketingProductsService: MarketingProductsService,
  ) {}

  listProductCategories(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingProductCategoriesResponseDto> {
    return this.marketingProductCategoriesService.listCategories(user, storeId);
  }

  createProductCategory(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateMarketingProductCategoryDto,
  ): Promise<MarketingProductCategoryDto> {
    return this.marketingProductCategoriesService.createCategory(
      user,
      storeId,
      dto,
    );
  }

  updateProductCategory(
    user: AuthenticatedUser,
    categoryId: number,
    dto: UpdateMarketingProductCategoryDto,
  ): Promise<MarketingProductCategoryDto> {
    return this.marketingProductCategoriesService.updateCategory(
      user,
      categoryId,
      dto,
    );
  }

  deleteProductCategory(
    user: AuthenticatedUser,
    categoryId: number,
  ): Promise<void> {
    return this.marketingProductCategoriesService.deleteCategory(
      user,
      categoryId,
    );
  }

  listProducts(
    user: AuthenticatedUser,
    query: ListMarketingProductsQueryDto,
  ): Promise<MarketingProductsResponseDto> {
    return this.marketingProductsService.listProducts(user, query);
  }

  createProduct(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateMarketingProductDto,
  ): Promise<MarketingProductDto> {
    return this.marketingProductsService.createProduct(user, storeId, dto);
  }

  updateProduct(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateMarketingProductDto,
  ): Promise<MarketingProductDto> {
    return this.marketingProductsService.updateProduct(user, productId, dto);
  }

  toggleProduct(
    user: AuthenticatedUser,
    productId: number,
    dto: ToggleMarketingProductDto,
  ): Promise<MarketingProductDto> {
    return this.marketingProductsService.toggleProduct(user, productId, dto);
  }

  deleteProduct(user: AuthenticatedUser, productId: number): Promise<void> {
    return this.marketingProductsService.deleteProduct(user, productId);
  }

  calculateTimingPrice(
    dto: CalculateTimingPriceDto,
  ): CalculateTimingPriceResponseDto {
    return this.marketingProductsService.calculateTimingPrice(dto);
  }
}
