import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  clubProductSelect,
  type ClubProductRecord,
} from './club-products.types';

@Injectable()
export class ClubProductQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 分页查询当前门店上架商品。
   * 游标基于自增 id 倒序翻页（与 orderBy 唯一对齐），调用方需传入 take+1 做“是否有下一页”探测。
   */
  listActiveByStore(
    storeId: number,
    categoryId?: number,
    cursor?: number,
    take?: number,
    keyword?: string,
  ): Promise<ClubProductRecord[]> {
    return this.prisma.marketingProduct.findMany({
      where: {
        storeId,
        isActive: true,
        ...(categoryId ? { categoryId } : {}),
        // 游标分页：仅取 id 小于上一页末尾 id 的数据，保证翻页不重不漏
        ...(cursor ? { id: { lt: cursor } } : {}),
        // 商品名称模糊搜索（MySQL 默认不区分大小写）
        ...(keyword ? { name: { contains: keyword } } : {}),
      },
      select: clubProductSelect,
      // 排序键必须与游标一致（id desc），否则翻页会漏数据或重复
      orderBy: { id: 'desc' },
      ...(take ? { take } : {}),
    });
  }

  getActiveDetailByStore(
    storeId: number,
    productId: number,
  ): Promise<ClubProductRecord | null> {
    return this.prisma.marketingProduct.findFirst({
      where: {
        id: productId,
        storeId,
        isActive: true,
      },
      select: clubProductSelect,
    });
  }

  /**
   * F9 修复：返回所有商品 id，避免 hot-only 过滤隐藏新上架商品。
   *
   * 背景：原实现按 createdAt desc 取前 CLUB_HOT_PRODUCT_COUNT 个作为"热销"，
   * 导致 B 端上架的商品只要不在这 N 个之内就会被全部隐藏。
   * MarketingProduct 表没有 isHot/isFeatured 字段，"热销"概念无法落地。
   *
   * 后续若引入真实销量统计，可改为按销量 desc 取前 N；现在直接返回全部保证可见性。
   */
  resolveHotProductIds(products: ClubProductRecord[]): Set<number> {
    return new Set(products.map((product) => product.id));
  }
}
