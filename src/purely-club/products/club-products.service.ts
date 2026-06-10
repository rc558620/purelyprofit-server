import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubStoresService } from '../stores/club-stores.service';
import type {
  ClubProductDto,
  ClubProductsResponseDto,
  ClubServiceProductTypeValue,
  ListClubProductsQueryDto,
} from './dto/club-product.dto';

const CLUB_HOT_PRODUCT_COUNT = 3;
const CLUB_FEATURED_PRODUCT_LIMIT = 6;
const CLUB_PRODUCT_NOT_FOUND_MESSAGE = '当前门店下找不到该服务商品';

const clubProductSelect = {
  id: true,
  categoryId: true,
  name: true,
  price: true,
  originalPrice: true,
  image: true,
  description: true,
  stock: true,
  durationMinutes: true,
  personCount: true,
  createdAt: true,
  category: {
    select: {
      name: true,
    },
  },
} as const;

interface ClubProductRecord {
  id: number;
  categoryId: number;
  name: string;
  price: number;
  originalPrice: number | null;
  image: string | null;
  description: string | null;
  stock?: number | null;
  durationMinutes: number | null;
  personCount: number | null;
  createdAt: Date;
  category?: {
    name: string;
  } | null;
}

@Injectable()
export class ClubProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubStoresService: ClubStoresService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListClubProductsQueryDto,
  ): Promise<ClubProductsResponseDto> {
    const currentStore = await this.clubStoresService.getCurrent(user);
    const products = await this.prisma.marketingProduct.findMany({
      where: {
        storeId: currentStore.id,
        isActive: true,
      },
      select: clubProductSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const hotProductIds = new Set(
      products.slice(0, CLUB_HOT_PRODUCT_COUNT).map((product) => product.id),
    );
    const featuredProducts = query.featured
      ? products.filter((product) => hotProductIds.has(product.id))
      : products;
    const resolvedLimit = this.resolveListLimit(query.featured, query.limit);
    const items = featuredProducts
      .slice(0, resolvedLimit)
      .map((product) => this.toClubProduct(product, hotProductIds));

    return { items };
  }

  async getDetail(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<ClubProductDto> {
    const currentStore = await this.clubStoresService.getCurrent(user);
    const product = await this.prisma.marketingProduct.findFirst({
      where: {
        id: productId,
        storeId: currentStore.id,
        isActive: true,
      },
      select: clubProductSelect,
    });
    if (!product) {
      throw new NotFoundException(CLUB_PRODUCT_NOT_FOUND_MESSAGE);
    }

    return this.toClubProduct(product, new Set([product.id]));
  }

  private toClubProduct(
    product: ClubProductRecord,
    hotProductIds: Set<number>,
  ): ClubProductDto {
    const isHot = hotProductIds.has(product.id);
    const categoryTag = this.getCategoryName(product);
    const stock = this.getProductStock(product);
    const tags = Array.from(
      new Set([
        ...(isHot ? ['热销'] : []),
        ...(categoryTag ? [categoryTag] : []),
        ...(product.personCount && product.personCount > 1 ? ['多人适用'] : []),
      ]),
    );

    return {
      id: String(product.id),
      name: product.name,
      description: product.description?.trim() || '暂无服务说明',
      coverImage: product.image?.trim() || '',
      originalPrice: this.convertFenToYuan(
        product.originalPrice ?? product.price,
      ),
      memberPrice: this.convertFenToYuan(product.price),
      type: this.resolveProductType(product),
      tags,
      isHot,
      ...(stock >= 0 ? { stock } : {}),
      ...(this.buildValidityDesc(product)
        ? { validityDesc: this.buildValidityDesc(product) }
        : {}),
      details: this.buildDetails(product),
    };
  }

  private resolveListLimit(
    featured: boolean | undefined,
    limit: number | undefined,
  ): number {
    if (typeof limit === 'number') {
      return limit;
    }

    return featured ? CLUB_FEATURED_PRODUCT_LIMIT : Number.MAX_SAFE_INTEGER;
  }

  private resolveProductType(
    product: ClubProductRecord,
  ): ClubServiceProductTypeValue {
    if (product.personCount && product.personCount > 1) {
      return 'package';
    }

    if (product.durationMinutes && product.durationMinutes >= 90) {
      return 'experience';
    }

    return 'product';
  }

  private buildValidityDesc(product: ClubProductRecord): string | undefined {
    const parts: string[] = [];
    if (product.durationMinutes) {
      parts.push(`单次服务约 ${product.durationMinutes} 分钟`);
    }
    if (product.personCount) {
      parts.push(`适用 ${product.personCount} 人`);
    }
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }

  private buildDetails(product: ClubProductRecord): string[] {
    const categoryName = this.getCategoryName(product);
    const stock = this.getProductStock(product);
    const details = [
      product.description?.trim() || '',
      categoryName ? `服务分类：${categoryName}` : '',
      product.durationMinutes
        ? `参考时长：${product.durationMinutes} 分钟`
        : '',
      product.personCount ? `适用人数：${product.personCount} 人` : '',
      stock >= 0 ? `当前库存：${stock} 份` : '',
    ].filter((item) => item.length > 0);

    return details.length > 0 ? details : ['暂无服务详情'];
  }

  private getCategoryName(product: ClubProductRecord): string {
    return product.category?.name?.trim() ?? '';
  }

  private getProductStock(product: ClubProductRecord): number {
    return typeof product.stock === 'number' ? product.stock : -1;
  }

  private convertFenToYuan(amountFen: number): number {
    return new Decimal(amountFen).div(100).toDecimalPlaces(2).toNumber();
  }
}
