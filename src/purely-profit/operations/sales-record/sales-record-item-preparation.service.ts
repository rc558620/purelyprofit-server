import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import { deriveProductProfit } from '../../goods/products/products.domain';
import type {
  CreateSalesRecordDto,
  SalesRecordItemInputDto,
} from './dto/sales-record.dto';
import {
  normalizeSignedMoney,
  parseNumericProductId,
} from './sales-record.utils';

export interface CatalogProductRecord {
  id: number;
  name: string;
  category: string;
  code: string;
  price: number;
  profit: number;
  costPrice: number | null;
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
  /**
   * P2b fix: 保留系统级虚拟商品 ID（如 'SYS_RENEW_DEDUCTION'），
   * 使下游可用 productId 而非 productName 判定抵扣项。
   */
  systemProductId?: string;
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
  /** 保留调用方的服务端权威成交单价，但利润仍由商品目录成本计算。 */
  preserveCallerSalePrices?: boolean;
  /**
   * 覆盖 SaleOrder.totalRevenue（元）。
   * 空间结账等场景下，抵扣项（预付款/续费抵扣）在 SaleOrderItem 中以正数存储，
   * 但 totalRevenue 必须反映实际结算金额（消费 - 抵扣，可能为负数），
   * 因此需要使用结算层计算的权威值，而非从 items 重新聚合。
   */
  totalRevenueOverride?: number;
  /** 覆盖 SaleOrder.totalProfit（元），与 totalRevenueOverride 同理。 */
  totalProfitOverride?: number;
  /** 扫码点餐订单的唯一来源关联，用于支付回调幂等。 */
  scanOrderId?: number;
  /**
   * 手工补录（录入订单）元数据：传入后订单落入手工补录号段（#M-），
   * 并携带就餐方式/来源渠道等补录字段。
   */
  manualEntry?: {
    diningMode: 'dineIn' | 'takeaway' | 'platform';
    sourceChannel?:
      | 'meituan'
      | 'eleme'
      | 'meituanVoucher'
      | 'douyin'
      | 'dianping'
      | 'other';
    externalOrderNo?: string | null;
    guestCount?: number | null;
    customerPhone?: string | null;
    diningTableId?: number | null;
  };
}

@Injectable()
export class SalesRecordItemPreparationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按明细中的商品 ID 批量加载门店商品目录。
   *
   * preview 与 create 共用，保证两侧拿到的目录快照口径一致。
   */
  async loadProductMap(
    storeId: number,
    items: SalesRecordItemInputDto[],
  ): Promise<Map<number, CatalogProductRecord>> {
    const numericProductIds = Array.from(
      new Set(
        items
          .map((item) => parseNumericProductId(item.productId))
          .filter((item): item is number => item !== null),
      ),
    );

    if (numericProductIds.length === 0) {
      return new Map();
    }

    const products: CatalogProductRecord[] = await this.prisma.product.findMany(
      {
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
          costPrice: true,
          stock: true,
          isActive: true,
          image: true,
        },
      },
    );

    return new Map(products.map((item) => [item.id, item]));
  }

  /**
   * 解析单条明细的权威单价与单件利润。
   *
   * ⚠️ preview 与 create **必须**共用此方法：早期 preview 直接用调用方传入的
   * salePrice/profit，而 create 用商品目录价格，导致「预览金额 ≠ 实际入账金额」
   * （商品在录入期间被改价时必现）。现在两条链路统一从这里取价。
   *
   * 目录商品的利润一律以目录（或 preserveCallerSalePrices 下按成本价推导）为准，
   * 手动项则忽略调用方 profit、由售价推导，杜绝金额篡改。
   */
  resolveItemPrices(
    matchedProduct: CatalogProductRecord | null,
    item: SalesRecordItemInputDto,
    options: CreateSalesRecordOptions = {},
  ): { salePrice: Money; profit: Money } {
    if (matchedProduct) {
      const salePrice =
        options.preserveCallerPrices || options.preserveCallerSalePrices
          ? normalizeSignedMoney(item.salePrice, '销售单价格式不正确')
          : Money.fromDbCents(matchedProduct.price);

      const profit = options.preserveCallerPrices
        ? normalizeSignedMoney(item.profit, '单件利润格式不正确')
        : options.preserveCallerSalePrices
          ? deriveProductProfit(
              salePrice,
              matchedProduct.costPrice == null
                ? null
                : Money.fromDbCents(matchedProduct.costPrice),
            )
          : Money.fromDbCents(matchedProduct.profit);

      return { salePrice, profit };
    }

    // ⚠️ 手动项利润由服务端从售价推导（无成本价时利润 = 售价），
    //    前端传入的 profit 字段一律忽略，杜绝金额篡改风险。
    //    与商品目录 deriveProductProfit(price, costPrice) 语义一致。
    const salePrice = normalizeSignedMoney(
      item.salePrice,
      '销售单价格式不正确',
    );

    return { salePrice, profit: deriveProductProfit(salePrice, null) };
  }

  async prepareItems(
    storeId: number,
    dto: CreateSalesRecordDto,
    options: CreateSalesRecordOptions = {},
  ): Promise<PreparedSalesItem[]> {
    const productMap = await this.loadProductMap(storeId, dto.items);

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

        const { salePrice, profit } = this.resolveItemPrices(
          matchedProduct,
          item,
          options,
        );

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

      if (productName === '') {
        throw new BadRequestException(`第 ${index + 1} 条商品名称不能为空`);
      }
      if (categoryName === '') {
        throw new BadRequestException(`第 ${index + 1} 条商品分类不能为空`);
      }

      const { salePrice, profit } = this.resolveItemPrices(
        matchedProduct,
        item,
        options,
      );

      // P2b fix: 非数值型 productId 保留为 systemProductId
      const rawProductId = item.productId?.trim();
      const systemProductId =
        rawProductId && numericProductId === null ? rawProductId : undefined;

      return {
        productId: null,
        productName,
        categoryName,
        salePrice,
        profit,
        quantity,
        countsTowardTotalQuantity: !salePrice.isNegative(),
        ...(systemProductId ? { systemProductId } : {}),
      };
    });
  }
}
