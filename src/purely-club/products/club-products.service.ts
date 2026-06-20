import { Injectable, NotFoundException } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubProductDto,
  ClubProductsResponseDto,
  ListClubProductsQueryDto,
} from './dto/club-product.dto';
import { ClubProductPromotionService } from './club-product-promotion.service';
import { ClubProductQueryService } from './club-product-query.service';
import { ClubProductViewService } from './club-product-view.service';
import {
  CLUB_FEATURED_PRODUCT_LIMIT,
  CLUB_PRODUCT_DEFAULT_LIST_LIMIT,
  CLUB_PRODUCT_NOT_FOUND_MESSAGE,
} from './club-products.types';

@Injectable()
export class ClubProductsService {
  constructor(
    private readonly clubProductQueryService: ClubProductQueryService,
    private readonly clubProductPromotionService: ClubProductPromotionService,
    private readonly clubProductViewService: ClubProductViewService,
  ) {}

  async list(
    currentContext: ClubCurrentContext,
    query: ListClubProductsQueryDto,
  ): Promise<ClubProductsResponseDto> {
    const [products, pricingContext] = await Promise.all([
      this.clubProductQueryService.listActiveByStore(
        currentContext.store.id,
        query.categoryId,
      ),
      this.clubProductPromotionService.resolvePricingContext(
        currentContext.store.id,
        currentContext.user.phone,
      ),
    ]);
    const hotProductIds =
      this.clubProductQueryService.resolveHotProductIds(products);
    const visibleProducts = query.featured
      ? products.filter((product) => hotProductIds.has(product.id))
      : products;
    const resolvedLimit = this.resolveListLimit(query.featured, query.limit);

    return {
      items: visibleProducts
        .slice(0, resolvedLimit)
        .map((product) =>
          this.clubProductViewService.toClubProduct(
            product,
            hotProductIds,
            pricingContext,
          ),
        ),
    };
  }

  async getDetail(
    currentContext: ClubCurrentContext,
    productId: number,
  ): Promise<ClubProductDto> {
    const product = await this.clubProductQueryService.getActiveDetailByStore(
      currentContext.store.id,
      productId,
    );
    if (!product) {
      throw new NotFoundException(CLUB_PRODUCT_NOT_FOUND_MESSAGE);
    }

    const pricingContext =
      await this.clubProductPromotionService.resolvePricingContext(
        currentContext.store.id,
        currentContext.user.phone,
      );

    return this.clubProductViewService.toClubProduct(
      product,
      new Set([product.id]),
      pricingContext,
    );
  }

  private resolveListLimit(
    featured: boolean | undefined,
    limit: number | undefined,
  ): number {
    if (typeof limit === 'number') {
      return limit;
    }

    return featured
      ? CLUB_FEATURED_PRODUCT_LIMIT
      : CLUB_PRODUCT_DEFAULT_LIST_LIMIT;
  }
}
