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

  listActiveByStore(storeId: number): Promise<ClubProductRecord[]> {
    return this.prisma.marketingProduct.findMany({
      where: {
        storeId,
        isActive: true,
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

  resolveHotProductIds(products: ClubProductRecord[]): Set<number> {
    return new Set(
      products.slice(0, CLUB_HOT_PRODUCT_COUNT).map((product) => product.id),
    );
  }
}
