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
    // 定价上下文（会员折扣/首单优惠/满减）与列表查询并行发起
    const pricingContextPromise =
      this.clubProductPromotionService.resolvePricingContext(
        currentContext.store.id,
        currentContext.user.phone,
      );

    // 服务列表分页路径：翻页（有 cursor）与服务列表首屏（无 cursor 无 featured）共用。
    // 首屏不带 cursor 从最新开始，同样返回 nextCursor 开启后续翻页；
    // featured 为恒等过滤（resolveHotProductIds 返回全部 id），故不参与游标语义；
    // 若同时传入 featured 与 cursor，以游标分页为准。
    if (query.featured !== true || query.cursor !== undefined) {
      const pageLimit = query.limit ?? CLUB_PRODUCT_DEFAULT_LIST_LIMIT;
      const probeTake = pageLimit + 1;
      const [pageRecords, pricingContext] = await Promise.all([
        this.clubProductQueryService.listActiveByStore(
          currentContext.store.id,
          query.categoryId,
          query.cursor,
          probeTake,
          query.keyword,
        ),
        pricingContextPromise,
      ]);
      // take+1 探测：取满则还有下一页，截掉探测行
      const hasMore = pageRecords.length === probeTake;
      const visibleRecords = hasMore ? pageRecords.slice(0, -1) : pageRecords;
      const hotProductIds =
        this.clubProductQueryService.resolveHotProductIds(visibleRecords);

      return {
        items: visibleRecords.map((product) =>
          this.clubProductViewService.toClubProduct(
            product,
            hotProductIds,
            pricingContext,
          ),
        ),
        nextCursor: hasMore ? (visibleRecords.at(-1)?.id ?? null) : null,
      };
    }

    // 首页精选路径（featured + limit）：全量查询后截断，不分页
    const [products, pricingContext] = await Promise.all([
      this.clubProductQueryService.listActiveByStore(
        currentContext.store.id,
        query.categoryId,
      ),
      pricingContextPromise,
    ]);
    const hotProductIds =
      this.clubProductQueryService.resolveHotProductIds(products);
    // 精选过滤：真实场景下 resolveHotProductIds 返回全部 id（恒等过滤），
    // 保留 filter 语义以兼容后续引入真实热门统计
    const visibleProducts = products.filter((product) =>
      hotProductIds.has(product.id),
    );
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
      // 精选路径恒不分页
      nextCursor: null,
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
