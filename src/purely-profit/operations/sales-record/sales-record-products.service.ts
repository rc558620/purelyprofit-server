import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { toDecimalNumber } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ListSalesProductsQueryDto,
  SalesProductResponseDto,
} from './dto/sales-record.dto';

@Injectable()
export class SalesRecordProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async listProducts(
    user: AuthenticatedUser,
    query: ListSalesProductsQueryDto,
  ): Promise<SalesProductResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'operation-entry:view',
      '无权查看该门店开始营业商品',
    );

    if (storeId === null) {
      return [];
    }

    const keyword = query.keyword;
    const category = keyword ? undefined : query.category;

    const products = await this.prisma.product.findMany({
      where: {
        storeId,
        isActive: true,
        ...(category ? { category } : {}),
        ...(keyword
          ? {
              OR: [
                {
                  name: {
                    contains: keyword,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  code: {
                    contains: keyword,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  category: {
                    contains: keyword,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        category: true,
        code: true,
        price: true,
        profit: true,
      },
    });

    return products.map((product) => ({
      id: String(product.id),
      name: product.name,
      category: product.category,
      code: product.code,
      // 注意：price 在前端语义代表"单件利润"，对应数据库 product.profit
      price: toDecimalNumber(product.profit),
      salePrice: toDecimalNumber(product.price),
      quantity: 0,
    }));
  }
}
