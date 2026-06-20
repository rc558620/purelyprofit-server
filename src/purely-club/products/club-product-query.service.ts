import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CLUB_HOT_PRODUCT_COUNT,
  clubProductSelect,
  type ClubProductRecord,
} from './club-products.types';

@Injectable()
export class ClubProductQueryService {
  constructor(private readonly prisma: PrismaService) {}

  listActiveByStore(
    storeId: number,
    categoryId?: number,
  ): Promise<ClubProductRecord[]> {
    return this.prisma.marketingProduct.findMany({
      where: {
        storeId,
        isActive: true,
        ...(categoryId ? { categoryId } : {}),
      },
      select: clubProductSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

  /** 临时占位：当前热销定义取最新创建的前 N 个商品，后续应改为按实际销量排序 */
  resolveHotProductIds(products: ClubProductRecord[]): Set<number> {
    return new Set(
      products.slice(0, CLUB_HOT_PRODUCT_COUNT).map((product) => product.id),
    );
  }
}
