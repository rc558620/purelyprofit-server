import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import { deriveProductProfit } from '../../goods/products/products.domain';
import type { CreateSalesRecordDto } from './dto/sales-record.dto';
import {
  normalizeSignedMoney,
  parseNumericProductId,
} from './sales-record.utils';

interface CatalogProductRecord {
  id: number;
  name: string;
  category: string;
  code: string;
  price: number;
  profit: number;
  stock: number;
  isActive: boolean;
  image: string | null;
}

export interface PreparedSalesItem {
  productId: number | null;
  productName: string;
  categoryName: string;
  salePrice: Money;
  profit: Money;
  quantity: number;
  countsTowardTotalQuantity: boolean;
  image?: string;
}

export interface CreateSalesRecordOptions {
  skipInventoryValidationAndDeduction?: boolean;
  /** 跳过 sales:create 权限校验，由调用方自行保证已完成上游权限检查（如空间结账） */
  skipAccessCheck?: boolean;
  /** 兼容 additional/space-management：主账号或店长下单时，优先归属到当前待交班班次员工 */
  assignToCurrentShiftOperator?: boolean;
  /** 复用外层事务，避免跨业务写链路出现部分提交 */
  transactionClient?: Prisma.TransactionClient;
  /** 保留调用方传入的单价/利润，不用商品目录当前价格覆盖（空间结账等场景） */
  preserveCallerPrices?: boolean;
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
            deletedAt: null,
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

        const salePrice = options.preserveCallerPrices
          ? normalizeSignedMoney(item.salePrice, '销售单价格式不正确')
          : Money.fromDbCents(matchedProduct.price);
        const profit = options.preserveCallerPrices
          ? normalizeSignedMoney(item.profit, '单件利润格式不正确')
          : Money.fromDbCents(matchedProduct.profit);

        return {
          productId: matchedProduct.id,
          productName: matchedProduct.name,
          categoryName: matchedProduct.category,
          salePrice,
          profit,
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

      // ⚠️ 手动项利润由服务端从售价推导（无成本价时利润 = 售价），
      //    前端传入的 profit 字段一律忽略，杜绝金额篡改风险。
      //    与商品目录 deriveProductProfit(price, costPrice) 语义一致。
      const profit = deriveProductProfit(salePrice, null);

      if (productName === '') {
        throw new BadRequestException(`第 ${index + 1} 条商品名称不能为空`);
      }
      if (categoryName === '') {
        throw new BadRequestException(`第 ${index + 1} 条商品分类不能为空`);
      }

      return {
        productId: null,
        productName,
        categoryName,
        salePrice,
        profit,
        quantity,
        countsTowardTotalQuantity: !salePrice.isNegative(),
      };
    });
  }
}
