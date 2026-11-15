import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubProductCacheService } from './club-product-cache.service';
import {
  clubProductSelect,
  type ClubProductRecord,
  type ListActiveProductsParams,
} from './club-products.types';

@Injectable()
export class ClubProductQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubProductCacheService: ClubProductCacheService,
  ) {}

  /**
   * 分页查询当前门店上架商品。
   *
   * 游标基于自增 id 倒序翻页（与 orderBy 唯一对齐），调用方传入 take+1 做
   * 「是否有下一页」探测。无 keyword 的门店级商品数据走短 TTL 版本化缓存；
   * keyword 是用户任意输入，key 空间无限且命中率低，直接回源（由 name 上的
   * GIN trgm 索引承接模糊匹配）。
   */
  async listActiveByStore(
    params: ListActiveProductsParams,
  ): Promise<ClubProductRecord[]> {
    const keyword = params.keyword?.trim() || undefined;
    if (keyword) {
      return this.findActiveByStore({ ...params, keyword });
    }

    const cacheKey =
      await this.clubProductCacheService.buildListCacheKey(params);
    const cached = await this.clubProductCacheService.readList(cacheKey);
    if (cached) {
      return cached;
    }

    const records = await this.findActiveByStore(params);
    await this.clubProductCacheService.writeList(cacheKey, records);
    return records;
  }

  /**
   * 按门店查询上架商品详情。
   *
   * 命中与「确认不存在」都走缓存：后者是短 TTL 负缓存，避免已删除 / 被枚举的
   * productId 每次都打到数据库。负缓存的安全边界由 detail key 里的商品版本
   * 保证 —— 上架、重新上架、改价都会切换版本，新 key 必然回源，
   * 因此不会出现「新上架商品被空值挡住」。
   */
  async getActiveDetailByStore(
    storeId: number,
    productId: number,
  ): Promise<ClubProductRecord | null> {
    const cacheKey = await this.clubProductCacheService.buildDetailCacheKey(
      storeId,
      productId,
    );
    // undefined = 未命中；null = 负缓存命中（确认不存在），无需回源
    const cached = await this.clubProductCacheService.readDetailEntry(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const product = await this.prisma.marketingProduct.findFirst({
      where: {
        id: productId,
        storeId,
        isActive: true,
      },
      select: clubProductSelect,
    });
    if (product) {
      await this.clubProductCacheService.writeDetailHit(cacheKey, product);
    } else {
      await this.clubProductCacheService.writeDetailAbsent(cacheKey);
    }
    return product;
  }

  private findActiveByStore(
    params: ListActiveProductsParams,
  ): Promise<ClubProductRecord[]> {
    const { storeId, categoryId, cursor, take, keyword } = params;
    return this.prisma.marketingProduct.findMany({
      where: {
        storeId,
        isActive: true,
        ...(categoryId ? { categoryId } : {}),
        // 游标分页：仅取 id 小于上一页末尾 id 的数据，保证翻页不重不漏
        ...(cursor ? { id: { lt: cursor } } : {}),
        // PostgreSQL 下 contains 编译为 LIKE '%kw%'（大小写敏感）；
        // 通配符已在 DTO 层拦截，模糊匹配由 marketing_products_name_trgm_idx 承接。
        ...(keyword ? { name: { contains: keyword } } : {}),
      },
      select: clubProductSelect,
      // 排序键必须与游标一致；(store_id, is_active[, category_id], id) 索引可反向扫描
      orderBy: { id: 'desc' },
      ...(take ? { take } : {}),
    });
  }

  /**
   * F9 修复：返回所有商品 id，避免 hot-only 过滤隐藏新上架商品。
   *
   * 背景：原实现按 createdAt desc 取前 3 个作为"热销"，
   * 导致 B 端上架的商品只要不在这 N 个之内就会被全部隐藏。
   * MarketingProduct 表没有 isHot/isFeatured 字段，"热销"概念无法落地。
   *
   * 后续若引入真实销量统计，可改为按销量 desc 取前 N；现在直接返回全部保证可见性。
   */
  resolveHotProductIds(products: ClubProductRecord[]): Set<number> {
    return new Set(products.map((product) => product.id));
  }
}
