import { ConflictException } from '@nestjs/common';
import { Money } from '../../shared/money.utils';
import type {
  OrderAmountBreakdown,
  PricedCartItem,
} from './club-scan-ordering-order.types';
import type { PromotionAdapterResult } from './scan-ordering-promotion.adapter';

const SPEC_UPDATED_MESSAGE = '商品规格已更新，请重新选择';
const SOLD_OUT_MESSAGE = '商品已售罄或库存不足';

/** 购物车定价所需的菜单商品最小形状（Prisma 查询结果的结构子集）。 */
export interface CartPricedProductSource {
  isActive: boolean;
  deletedAt: Date | null;
  stockMode: string;
  stockQuantity: number | null;
  reservedQuantity: number | null;
  product: {
    isActive: boolean;
    deletedAt: Date | null;
    stock: number;
  } | null;
}

/** 规格组最小形状（Prisma specGroups → options 的结构子集）。 */
export interface CartSpecGroupSource {
  minSelections: number;
  maxSelections: number | null;
  options: Array<{
    id: number;
    name: string;
    extraPrice: number;
    isActive: boolean;
  }>;
}

/** 预览金额明细行。 */
export interface PreviewBreakdownItem {
  type: string;
  label: string;
  amount: number;
  isStrikethrough?: boolean;
}

/**
 * 校验购物车行对应的菜单商品可售，并返回收窄后的商品。
 * 可用库存 = 总库存 - 已下单未接单的预留量（接单后才真正扣减）。
 */
export const requireSellableProduct = <T extends CartPricedProductSource>(
  product: T | undefined,
  quantity: number,
): T => {
  if (!product) throw new ConflictException(SOLD_OUT_MESSAGE);
  const inventoryProduct = product.product;
  const baseStock = inventoryProduct
    ? inventoryProduct.stock
    : (product.stockQuantity ?? 0);
  const availableStock = baseStock - (product.reservedQuantity ?? 0);
  if (
    !product.isActive ||
    product.deletedAt ||
    (inventoryProduct &&
      (!inventoryProduct.isActive || inventoryProduct.deletedAt)) ||
    product.stockMode === 'sold_out' ||
    (product.stockMode === 'finite' && availableStock < quantity)
  ) {
    throw new ConflictException(SOLD_OUT_MESSAGE);
  }
  return product;
};

/** 解析购物车行选中的规格：规格失效、数量不匹配或违反组的选配约束时拒绝。 */
export const resolveCartItemSpecs = (
  specGroups: CartSpecGroupSource[],
  selectedOptionIds: number[],
): Array<{ specOptionId: number; name: string; extraPrice: number }> => {
  const selectedIds = new Set(selectedOptionIds);
  const specs = specGroups.flatMap((group) =>
    group.options
      .filter((option) => selectedIds.has(option.id) && option.isActive)
      .map((option) => ({
        specOptionId: option.id,
        name: option.name,
        extraPrice: option.extraPrice,
      })),
  );
  if (specs.length !== selectedIds.size) {
    throw new ConflictException(SPEC_UPDATED_MESSAGE);
  }
  for (const group of specGroups) {
    const selectedCount = specs.filter((spec) =>
      group.options.some((option) => option.id === spec.specOptionId),
    ).length;
    if (
      selectedCount < group.minSelections ||
      (group.maxSelections !== null && selectedCount > group.maxSelections)
    ) {
      throw new ConflictException(SPEC_UPDATED_MESSAGE);
    }
  }
  return specs;
};

/** 行金额：单价 = 基准价 + Σ 规格加价；行小计 = 单价 × 数量。 */
export const priceLineItem = (
  basePrice: number,
  specs: Array<{ extraPrice: number }>,
  quantity: number,
): { unitPriceAmount: number; lineTotalAmount: number } => {
  const specExtraMoney = specs.reduce<Money>(
    (sum, spec) => sum.add(Money.fromDbCents(spec.extraPrice)),
    Money.zero(),
  );
  const unitPriceMoney = Money.fromDbCents(basePrice).add(specExtraMoney);
  return {
    unitPriceAmount: unitPriceMoney.toDbCents(),
    lineTotalAmount: unitPriceMoney.multiply(quantity).toDbCents(),
  };
};

/** 组装预览金额明细：商品原价 + 营销明细 + 服务费 + 税费。 */
export const buildPreviewBreakdownItems = (
  amounts: OrderAmountBreakdown,
  promotion: PromotionAdapterResult,
): PreviewBreakdownItem[] => {
  const breakdownItems: PreviewBreakdownItem[] = [
    { type: 'item', label: '商品原价', amount: amounts.itemOriginalAmount },
    ...promotion.breakdownItems,
  ];
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
  return breakdownItems;
};

/**
 * 按行金额比例分摊商品级优惠（分）。
 *
 * 两条硬约束：
 * 1. 各行 discountAmount 之和尽可能精确等于总商品级优惠（余数由末行承担）；
 * 2. 单行 discountAmount 不得超过该行 lineTotalAmount —— 否则 payableLineAmount
 *    被 clamp 成 0，Σ 行应付会与订单级 payableAmount 对不上。
 *    因此按「剩余优惠 / 剩余行金额」比例分摊并逐行封顶，封顶挤出来的余额
 *    再回补给仍有余量的行。
 */
export const allocateLineDiscounts = (
  items: PricedCartItem[],
  productDiscountAmount: number,
): number[] => {
  if (items.length === 0) return [];

  const totalDiscount = Money.max(
    Money.fromDbCents(productDiscountAmount),
    Money.zero(),
  );
  const lineTotals = items.map((item) =>
    Money.max(Money.fromDbCents(item.lineTotalAmount), Money.zero()),
  );
  const totalLineAmount = Money.sum(lineTotals);

  // 行金额合计为 0：无从按比例分摊，全部记 0 优惠
  if (totalLineAmount.isZero()) return items.map(() => 0);

  const allocations = items.map(() => Money.zero());
  let allocatedDiscount = Money.zero();
  let remainingLineAmount = totalLineAmount;

  items.forEach((item, index) => {
    const lineTotal = lineTotals[index];
    const remainingDiscount = totalDiscount.subtract(allocatedDiscount);
    const proportional =
      index === items.length - 1
        ? remainingDiscount
        : Money.fromDbCents(
            Math.floor(
              remainingLineAmount.isZero()
                ? 0
                : (lineTotal.toDbCents() * remainingDiscount.toDbCents()) /
                    remainingLineAmount.toDbCents(),
            ),
          );
    allocations[index] = Money.min(
      Money.max(proportional, Money.zero()),
      lineTotal,
    );
    allocatedDiscount = allocatedDiscount.add(allocations[index]);
    remainingLineAmount = remainingLineAmount.subtract(lineTotal);
  });

  // 封顶挤出来的余额回补给仍有余量的行，保证总额精确
  let leftover = totalDiscount.subtract(Money.sum(allocations));
  for (
    let index = items.length - 1;
    index >= 0 && leftover.isPositive();
    index--
  ) {
    const headroom = lineTotals[index].subtract(allocations[index]);
    if (!headroom.isPositive()) continue;
    const delta = Money.min(headroom, leftover);
    allocations[index] = allocations[index].add(delta);
    leftover = leftover.subtract(delta);
  }

  return allocations.map((value) => value.toDbCents());
};

/**
 * 购物车版本：各行的「数量 + 单价」之和，用于校验前端快照是否过期。
 *
 * 与 `cartVersion` 的另两种含义区分开：
 * - `ScanOrderingCartItem.version` 是单行乐观锁版本（改量/删除时做 CAS）；
 * - 购物车整体 `version` 是各行乐观锁版本之和；
 * - **本函数**的结果才是 preview / create 校验用的 cartVersion。
 * 三者不可混用，否则下单会永久 409。
 */
export const computeCartVersion = (
  items: Array<{ quantity: number; unitPriceAmount: number }>,
): number =>
  items.reduce((sum, item) => sum + item.quantity + item.unitPriceAmount, 0);
