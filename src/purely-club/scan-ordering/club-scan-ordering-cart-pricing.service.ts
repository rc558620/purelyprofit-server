import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import { ScanOrderingPromotionAdapter } from './scan-ordering-promotion.adapter';
import type {
  PromotionAdapterInput,
  PromotionAdapterResult,
} from './scan-ordering-promotion.adapter';
import {
  allocateLineDiscounts,
  buildPreviewBreakdownItems,
  computeCartVersion,
  priceLineItem,
  requireSellableProduct,
  resolveCartItemSpecs,
} from './club-scan-ordering-cart-pricing.utils';
import type {
  OrderAmountBreakdown,
  PricedCartItem,
  PreviewResult,
  ScanOrderingOrderItemCreateData,
} from './club-scan-ordering-order.types';
import type { PreviewClubScanOrderDto } from './dto/club-scan-ordering.dto';

/** C 端扫码点餐购物车定价与金额计算服务。 */
@Injectable()
export class ClubScanOrderingCartPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotionAdapter: ScanOrderingPromotionAdapter,
  ) {}

  async priceCart(
    sessionId: number,
    storeId: number,
  ): Promise<PricedCartItem[]> {
    const cartItems = await this.prisma.scanOrderingCartItem.findMany({
      where: { sessionId, status: 'active', deletedAt: null },
      include: { specs: true },
    });
    if (cartItems.length === 0) throw new ConflictException('购物车为空');
    const products = await this.prisma.scanOrderingMenuProduct.findMany({
      where: {
        id: { in: cartItems.map((item) => item.menuProductId) },
        storeId,
        deletedAt: null,
      },
      include: {
        category: true,
        product: {
          select: { image: true, isActive: true, deletedAt: true, stock: true },
        },
        specGroups: { include: { options: true } },
      },
    });
    // 同一商品的不同规格会形成多条购物车行，但菜单商品查询按 ID 去重。
    // 必须与去重后的商品 ID 数量比较，不能与购物车行数比较。
    const cartProductIds = new Set(cartItems.map((item) => item.menuProductId));
    if (products.length !== cartProductIds.size) {
      const foundProductIds = new Set(products.map((product) => product.id));
      const missingProductIds = [...cartProductIds]
        .filter((productId) => !foundProductIds.has(productId))
        .join(',');
      throw new ConflictException(
        `购物车中存在已删除商品（菜单商品 ID：${missingProductIds}）`,
      );
    }
    return cartItems.map((cartItem) => {
      const product = requireSellableProduct(
        products.find((item) => item.id === cartItem.menuProductId),
        cartItem.quantity,
      );
      const specs = resolveCartItemSpecs(
        product.specGroups,
        cartItem.specs.map((spec) => spec.specOptionId),
      );
      const { unitPriceAmount, lineTotalAmount } = priceLineItem(
        product.basePrice,
        specs,
        cartItem.quantity,
      );
      return {
        cartItemId: cartItem.id,
        productId: product.id,
        inventoryProductId: product.productId,
        productName: product.name,
        productImageUrl: product.product?.image ?? product.imageUrl,
        categoryName: product.category.name,
        quantity: cartItem.quantity,
        specSignature: cartItem.specSignature,
        basePrice: product.basePrice,
        unitPriceAmount,
        lineTotalAmount,
        specs,
      };
    });
  }

  async resolvePromotions(
    storeId: number,
    clubUserId: number,
    sessionId: number,
    pricedItems: PricedCartItem[],
    usePoints: boolean,
  ): Promise<PromotionAdapterResult> {
    const adapterInput: PromotionAdapterInput = {
      storeId,
      clubUserId,
      sessionId,
      items: pricedItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPriceAmount: item.unitPriceAmount,
        specOptionIds: item.specs.map((spec) => spec.specOptionId),
      })),
      usePoints,
    };
    return this.promotionAdapter.resolvePromotions(adapterInput);
  }

  /**
   * 使用 Money 值对象计算订单全部金额。
   *
   * 所有金额均以"分"为内部单位：
   * - itemOriginalAmount = Σ(basePrice × quantity)
   * - specificationExtraAmount = Σ(specExtraPrice × quantity) = payableBeforeDiscount - itemOriginal
   * - productDiscountAmount = 营销适配器返回的商品级优惠
   * - orderDiscountAmount = 营销适配器返回的订单级优惠
   * - serviceFeeAmount = 0（当前无服务费）
   * - taxAmount = 0（当前无税费）
   * - payableAmount = itemOriginal + specExtra - productDiscount - orderDiscount + serviceFee + tax
   */
  calculateAmounts(
    items: PricedCartItem[],
    promotion: PromotionAdapterResult,
  ): OrderAmountBreakdown {
    let itemOriginalAmount = Money.zero();
    let lineTotalAmount = Money.zero();

    for (const item of items) {
      itemOriginalAmount = itemOriginalAmount.add(
        Money.fromDbCents(item.basePrice).multiply(item.quantity),
      );
      lineTotalAmount = lineTotalAmount.add(
        Money.fromDbCents(item.lineTotalAmount),
      );
    }

    const specificationExtraAmount =
      lineTotalAmount.subtract(itemOriginalAmount);
    const productDiscountAmount = Money.fromDbCents(
      promotion.productDiscountAmount,
    );
    const orderDiscountAmount = Money.fromDbCents(
      promotion.orderDiscountAmount,
    );
    const serviceFeeAmount = Money.zero();
    const taxAmount = Money.zero();

    const payableAmount = itemOriginalAmount
      .add(specificationExtraAmount)
      .subtractClampedToZero(productDiscountAmount)
      .subtractClampedToZero(orderDiscountAmount)
      .add(serviceFeeAmount)
      .add(taxAmount);

    return {
      itemOriginalAmount: itemOriginalAmount.toDbCents(),
      specificationExtraAmount: specificationExtraAmount.toDbCents(),
      productDiscountAmount: productDiscountAmount.toDbCents(),
      orderDiscountAmount: orderDiscountAmount.toDbCents(),
      serviceFeeAmount: serviceFeeAmount.toDbCents(),
      taxAmount: taxAmount.toDbCents(),
      payableAmount: payableAmount.toDbCents(),
    };
  }

  toPreview(
    sessionId: number,
    dto: PreviewClubScanOrderDto,
    items: PricedCartItem[],
    cartVersion: number,
    pricingVersion: string,
    amounts: OrderAmountBreakdown,
    promotion: PromotionAdapterResult,
  ): PreviewResult {
    // 原价（分）= 商品原价 + 规格加价；总优惠由后端计算，前端只读展示
    const originalAmount =
      amounts.itemOriginalAmount + amounts.specificationExtraAmount;
    return {
      sessionId,
      guestCount: dto.guestCount,
      remark: dto.remark ?? null,
      cartVersion,
      pricingVersion,
      ...amounts,
      totalSavingAmount: Math.max(originalAmount - amounts.payableAmount, 0),
      totalSavingWithPoints: Math.max(
        originalAmount - promotion.afterPointsPayableAmount,
        0,
      ),
      pointsDeductAmount: promotion.pointsDeductAmount,
      pointsUsed: promotion.pointsUsed,
      afterPointsPayableAmount: promotion.afterPointsPayableAmount,
      redeemRatioPoints: promotion.redeemRatioPoints,
      availablePoints: promotion.availablePoints,
      breakdownItems: buildPreviewBreakdownItems(amounts, promotion),
      availableCoupons: promotion.availableCoupons,
      appliedPromotions: promotion.appliedPromotions,
      items,
    };
  }

  async reserveFiniteSpecStock(
    tx: Prisma.TransactionClient,
    items: PricedCartItem[],
  ): Promise<void> {
    const quantities = new Map<number, number>();
    for (const item of items) {
      for (const spec of item.specs) {
        quantities.set(
          spec.specOptionId,
          (quantities.get(spec.specOptionId) ?? 0) + item.quantity,
        );
      }
    }
    const specOptionIds = [...quantities.keys()];
    const currentOptions = await tx.scanOrderingSpecOption.findMany({
      where: { id: { in: specOptionIds } },
      select: {
        id: true,
        stockQuantity: true,
        reservedQuantity: true,
        version: true,
      },
    });
    const optionMap = new Map(
      currentOptions.map((option) => [option.id, option]),
    );
    for (const [specOptionId, quantity] of quantities) {
      const current = optionMap.get(specOptionId);
      if (!current) throw new ConflictException('规格库存不足');
      const availableStock =
        (current.stockQuantity ?? 0) - (current.reservedQuantity ?? 0);
      if (current.stockQuantity !== null && availableStock < quantity) {
        throw new ConflictException('规格库存不足');
      }
      const updated = await tx.scanOrderingSpecOption.updateMany({
        where: {
          id: specOptionId,
          isActive: true,
          version: current.version,
        },
        data: {
          reservedQuantity: { increment: quantity },
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConflictException('规格库存不足');
    }
  }

  /** 构建订单项创建数据，优惠分摊见 {@link allocateLineDiscounts}。 */
  buildOrderItemCreateData(
    items: PricedCartItem[],
    productDiscountAmount: number,
    storeId: number,
  ): ScanOrderingOrderItemCreateData[] {
    const discountAmounts = allocateLineDiscounts(items, productDiscountAmount);

    return items.map((item, index) => {
      const discountAmount = discountAmounts[index];
      const payableLineAmount = Money.fromDbCents(
        item.lineTotalAmount,
      ).subtractClampedToZero(Money.fromDbCents(discountAmount));

      return {
        storeId,
        menuProductId: item.productId,
        productNameSnapshot: item.productName,
        productImageUrlSnapshot: item.productImageUrl,
        categoryNameSnapshot: item.categoryName,
        specSignature: item.specSignature,
        quantity: item.quantity,
        basePriceSnapshot: item.basePrice,
        unitPriceAmount: item.unitPriceAmount,
        lineTotalAmount: item.lineTotalAmount,
        discountAmount,
        payableLineAmount: payableLineAmount.toDbCents(),
        sortOrder: index,
        specs: {
          create: item.specs.map((spec) => ({
            specOptionId: spec.specOptionId,
            specOptionNameSnapshot: spec.name,
            extraPriceSnapshot: spec.extraPrice,
          })),
        },
      };
    });
  }

  cartVersion(items: PricedCartItem[]): number {
    return computeCartVersion(items);
  }
}
