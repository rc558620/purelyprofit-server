import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { toDecimalNumber } from '../../commerce/commerce.utils';
import type { CreateSalesRecordDto } from './dto/sales-record.dto';
import {
  normalizeMoney,
  normalizeSignedMoney,
  parseNumericProductId,
} from './sales-record.utils';

interface CatalogProductRecord {
  id: number;
  name: string;
  category: string;
  code: string;
  price: Prisma.Decimal;
  profit: Prisma.Decimal;
  stock: number;
  isActive: boolean;
  image: string | null;
}

export interface PreparedSalesItem {
  productId: number | null;
  productName: string;
  categoryName: string;
  salePrice: number;
  profit: number;
  quantity: number;
  countsTowardTotalQuantity: boolean;
  image?: string;
}

export interface CreateSalesRecordOptions {
  skipInventoryValidationAndDeduction?: boolean;
}

@Injectable()
export class SalesRecordItemPreparationService {
  constructor(private readonly prisma: PrismaService) {}

  async prepareItems(
    storeId: number,
    dto: CreateSalesRecordDto,
    options: CreateSalesRecordOptions = {},
  ): Promise<PreparedSalesItem[]> {
    const numericProductIds = Array.from(
      new Set(
        dto.items
          .map((item) => parseNumericProductId(item.productId))
          .filter((item): item is number => item !== null),
      ),
    );

    const products: CatalogProductRecord[] = numericProductIds.length
      ? await this.prisma.product.findMany({
          where: {
            storeId,
            id: { in: numericProductIds },
          },
          select: {
            id: true,
            name: true,
            category: true,
            code: true,
            price: true,
            profit: true,
            stock: true,
            isActive: true,
            image: true,
          },
        })
      : [];
    const productMap = new Map(products.map((item) => [item.id, item]));

    if (productMap.size !== numericProductIds.length) {
      throw new NotFoundException('存在无效商品，无法创建销售记录');
    }

    return dto.items.map((item, index) => {
      const numericProductId = parseNumericProductId(item.productId);
      const matchedProduct =
        numericProductId === null
          ? null
          : (productMap.get(numericProductId) ?? null);
      const quantity = item.quantity;

      if (quantity <= 0) {
        throw new BadRequestException(`第 ${index + 1} 条销售数量必须大于 0`);
      }

      if (matchedProduct) {
        if (!matchedProduct.isActive) {
          throw new BadRequestException(
            `商品【${matchedProduct.name}】已下架，无法销售`,
          );
        }
        if (
          !options.skipInventoryValidationAndDeduction &&
          matchedProduct.stock < quantity
        ) {
          throw new BadRequestException(
            `商品【${matchedProduct.name}】库存不足`,
          );
        }

        return {
          productId: matchedProduct.id,
          productName: matchedProduct.name,
          categoryName: matchedProduct.category,
          salePrice: normalizeMoney(
            toDecimalNumber(matchedProduct.price),
            '销售单价不能小于 0',
          ),
          profit: normalizeMoney(
            toDecimalNumber(matchedProduct.profit),
            '单件利润不能小于 0',
          ),
          quantity,
          countsTowardTotalQuantity: true,
          image: matchedProduct.image ?? undefined,
        };
      }

      const productName = item.productName.trim();
      const categoryName = item.categoryName.trim();
      const salePrice = normalizeSignedMoney(
        item.salePrice,
        '销售单价格式不正确',
      );
      const profit = normalizeSignedMoney(item.profit, '单件利润格式不正确');

      if (productName === '') {
        throw new BadRequestException(`第 ${index + 1} 条商品名称不能为空`);
      }
      if (categoryName === '') {
        throw new BadRequestException(`第 ${index + 1} 条商品分类不能为空`);
      }

      const isNegativeSalePrice = salePrice < 0;
      const isNegativeProfit = profit < 0;
      if (isNegativeSalePrice !== isNegativeProfit) {
        throw new BadRequestException(
          `第 ${index + 1} 条抵扣项销售额和利润必须同号`,
        );
      }

      return {
        productId: null,
        productName,
        categoryName,
        salePrice,
        profit,
        quantity,
        countsTowardTotalQuantity: salePrice >= 0 && profit >= 0,
      };
    });
  }
}
