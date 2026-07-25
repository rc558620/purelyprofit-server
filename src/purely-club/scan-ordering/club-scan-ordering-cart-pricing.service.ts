import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import { ScanOrderingPromotionAdapter } from './scan-ordering-promotion.adapter';
import type {
  PromotionAdapterInput,
  PromotionAdapterResult,
} from './scan-ordering-promotion.adapter';
import type {
  OrderAmountBreakdown,
  PricedCartItem,
  PreviewResult,
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
        isActive: true,
        deletedAt: null,
      },
      include: { category: true, specGroups: { include: { options: true } } },
    });
    if (products.length !== cartItems.length)
      throw new ConflictException('购物车中存在已下架商品');
    return cartItems.map((cartItem) => {
      const product = products.find(
        (item) => item.id === cartItem.menuProductId,
      );
      if (
        !product ||
        product.stockMode === 'sold_out' ||
        (product.stockMode === 'finite' &&
          (product.stockQuantity ?? 0) < cartItem.quantity)
      )
        throw new ConflictException('商品已售罄或库存不足');
      const selectedIds = new Set(
        cartItem.specs.map((spec) => spec.specOptionId),
      );
      const specs = product.specGroups.flatMap((group) =>
        group.options
          .filter((option) => selectedIds.has(option.id))
          .map((option) => ({
            specOptionId: option.id,
            name: option.name,
            extraPrice: option.extraPrice,
          })),
      );
      const basePriceMoney = Money.fromDbCents(product.basePrice);
      const specExtraMoney = specs.reduce<Money>(
        (sum, spec) => sum.add(Money.fromDbCents(spec.extraPrice)),
        Money.zero(),
      );
      const unitPriceMoney = basePriceMoney.add(specExtraMoney);
      const lineTotalMoney = unitPriceMoney.multiply(cartItem.quantity);
      return {
        cartItemId: cartItem.id,
        productId: product.id,
        productName: product.name,
        productImageUrl: product.imageUrl,
        categoryName: product.category.name,
        quantity: cartItem.quantity,
        specSignature: cartItem.specSignature,
        basePrice: product.basePrice,
        unitPriceAmount: unitPriceMoney.toDbCents(),
        lineTotalAmount: lineTotalMoney.toDbCents(),
        specs,
      };
    });
  }

  async resolvePromotions(
    storeId: number,
    clubUserId: number,
    sessionId: number,
    pricedItems: PricedCartItem[],
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
    const breakdownItems: Array<{
      type: string;
      label: string;
      amount: number;
    }> = [
      { type: 'item', label: '商品原价', amount: amounts.itemOriginalAmount },
      {
        type: 'specification',
        label: '规格加价',
        amount: amounts.specificationExtraAmount,
      },
    ];
    if (amounts.productDiscountAmount > 0) {
      breakdownItems.push({
        type: 'membership',
        label: '会员优惠',
        amount: -amounts.productDiscountAmount,
      });
    }
    if (amounts.orderDiscountAmount > 0) {
      breakdownItems.push({
        type: 'coupon',
        label: '优惠券抵扣',
        amount: -amounts.orderDiscountAmount,
      });
    }
    for (const promo of promotion.appliedPromotions) {
      breakdownItems.push({
        type: 'promotion',
        label: promo.name,
        amount: -promo.discountAmount,
      });
    }
    if (amounts.serviceFeeAmount > 0) {
      breakdownItems.push({
        type: 'service_fee',
        label: '服务费',
        amount: amounts.serviceFeeAmount,
      });
    }
    if (amounts.taxAmount > 0) {
      breakdownItems.push({
        type: 'tax',
        label: '税费',
        amount: amounts.taxAmount,
      });
    }
    return {
      sessionId,
      guestCount: dto.guestCount,
      remark: dto.remark ?? null,
      cartVersion,
      pricingVersion,
      itemOriginalAmount: amounts.itemOriginalAmount,
      specificationExtraAmount: amounts.specificationExtraAmount,
      productDiscountAmount: amounts.productDiscountAmount,
      orderDiscountAmount: amounts.orderDiscountAmount,
      serviceFeeAmount: amounts.serviceFeeAmount,
      taxAmount: amounts.taxAmount,
      payableAmount: amounts.payableAmount,
      breakdownItems,
      availableCoupons: promotion.availableCoupons,
      appliedPromotions: promotion.appliedPromotions,
      items,
    };
  }

  async reserveFiniteSpecStock(
    tx: import('@prisma/client').Prisma.TransactionClient,
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
    for (const [specOptionId, quantity] of quantities) {
      const updated = await tx.scanOrderingSpecOption.updateMany({
        where: {
          id: specOptionId,
          isActive: true,
          OR: [{ stockQuantity: null }, { stockQuantity: { gte: quantity } }],
        },
        data: {
          stockQuantity: { decrement: quantity },
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConflictException('规格库存不足');
    }
  }

  /**
   * 构建订单项创建数据，包含优惠分摊。
   *
   * 优惠按行金额比例分摊，余数分配到最后一个订单项，
   * 确保各订单项 discountAmount 之和精确等于总商品级优惠。
   */
  buildOrderItemCreateData(
    items: PricedCartItem[],
    productDiscountAmount: number,
    storeId: number,
  ): Array<{
    storeId: number;
    menuProductId: number;
    productNameSnapshot: string;
    productImageUrlSnapshot: string | null;
    categoryNameSnapshot: string;
    specSignature: string;
    quantity: number;
    basePriceSnapshot: number;
    unitPriceAmount: number;
    lineTotalAmount: number;
    discountAmount: number;
    payableLineAmount: number;
    sortOrder: number;
    specs: {
      create: Array<{
        specOptionId: number;
        specOptionNameSnapshot: string;
        extraPriceSnapshot: number;
      }>;
    };
  }> {
    const totalDiscount = Money.fromDbCents(productDiscountAmount);
    const totalLineAmount = Money.sum(
      items.map((item) => Money.fromDbCents(item.lineTotalAmount)),
    );

    let allocatedDiscount = Money.zero();

    return items.map((item, index) => {
      const lineAmount = Money.fromDbCents(item.lineTotalAmount);
      let itemDiscount: Money;

      if (index === items.length - 1) {
        // 最后一个订单项承担余数，确保总额精确
        itemDiscount = totalDiscount.subtract(allocatedDiscount);
      } else if (totalLineAmount.toDbCents() > 0) {
        // 按行金额比例分摊
        itemDiscount = Money.fromDbCents(
          Math.floor(
            (lineAmount.toDbCents() * totalDiscount.toDbCents()) /
              totalLineAmount.toDbCents(),
          ),
        );
        allocatedDiscount = allocatedDiscount.add(itemDiscount);
      } else {
        itemDiscount = Money.zero();
      }

      const payableLineAmount = lineAmount.subtractClampedToZero(itemDiscount);

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
        discountAmount: itemDiscount.toDbCents(),
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
    return items.reduce(
      (sum, item) => sum + item.quantity + item.unitPriceAmount,
      0,
    );
  }
}
