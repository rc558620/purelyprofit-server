// 录入订单定价服务：规格组合单价、商品合计、券面抵扣与应付金额的唯一权威计算（全部走 Money 值对象）

import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { Money } from '../../../../shared/money.utils';
import type {
  ManualEntryItemDto,
  ManualEntryPaymentMethodValue,
} from './dto/manual-entry.dto';
import type {
  ManualEntryPreviewItem,
  ManualEntryPreviewResponse,
} from './manual-entry.types';

/** 定价后的明细行（金额均为分，供落库与预览复用）。 */
export interface ManualEntryPricedItem {
  /** 菜单商品 ID */
  menuProductId: number;
  /** 商品名称快照（不含规格） */
  productName: string;
  /** 分类 ID */
  categoryId: number;
  /** 分类名称快照 */
  categoryName: string;
  /** 关联商品库商品 ID（无关联为 null） */
  inventoryProductId: number | null;
  /** 已选规格选项 ID（升序） */
  specOptionIds: number[];
  /** 规格名称快照（升序） */
  specNames: string[];
  /** 商品展示名（含规格后缀，如「拿铁（大杯/热）」） */
  displayName: string;
  /** 基础价快照（分） */
  basePriceCents: number;
  /** 规格组合单价（分；基础价 + 加价合计） */
  unitPriceCents: number;
  /** 数量 */
  quantity: number;
  /** 行小计（分） */
  lineTotalCents: number;
}

/** 金额汇总（分）。 */
export interface ManualEntryAmounts {
  /** 商品合计（分） */
  itemsTotalCents: number;
  /** 券面抵扣优惠（分） */
  discountCents: number;
  /** 应付金额（分） */
  payableCents: number;
}

/** 录入订单定价与金额计算服务（金额计算唯一权威）。 */
@Injectable()
export class ManualEntryPricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 对明细行定价：校验商品在售、规格选择合法、库存充足后，
   * 按基础价 + 规格加价计算组合单价与行小计（与 C 端点餐同一口径）。
   */
  async priceItems(
    storeId: number,
    items: ManualEntryItemDto[],
  ): Promise<ManualEntryPricedItem[]> {
    const menuProductIdSet = new Set(items.map((item) => item.productId));
    const menuProductIds = [...menuProductIdSet];
    const products = await this.prisma.scanOrderingMenuProduct.findMany({
      where: {
        id: { in: menuProductIds },
        storeId,
        deletedAt: null,
      },
      include: {
        category: { select: { id: true, name: true } },
        product: {
          select: { id: true, isActive: true, deletedAt: true, stock: true },
        },
        specGroups: {
          where: { isActive: true },
          include: { options: { where: { isActive: true } } },
        },
      },
    });
    const productMap = new Map(
      products.map((product) => [product.id, product]),
    );
    if (products.length !== menuProductIdSet.size) {
      throw new BadRequestException('存在已下架或已删除的菜单商品，请刷新菜单');
    }

    return items.map((item) =>
      this.priceItem(item, productMap.get(item.productId)!),
    );
  }

  /**
   * 计算订单金额：商品合计 = Σ 单价 × 数量；
   * 平台结算且券面有效时：应付 = min(券面, 合计)，优惠 = 合计 − 应付（封顶不找零）。
   */
  calculateAmounts(
    pricedItems: ManualEntryPricedItem[],
    paymentMethod: ManualEntryPaymentMethodValue,
    voucherAmountYuan: number | undefined,
  ): ManualEntryAmounts {
    const itemsTotal = Money.sum(
      pricedItems.map((item) => Money.fromDbCents(item.lineTotalCents)),
    );
    const voucher =
      paymentMethod === 'platform' && voucherAmountYuan !== undefined
        ? Money.fromInputYuan(voucherAmountYuan)
        : null;
    // 券面封顶不找零：顾客实付 = min(券面, 合计)，差额记为优惠；
    // 未录入券面时应付 = 合计、优惠为 0（与 handoff 3.3 契约一致）
    const payable =
      voucher !== null ? Money.min(voucher, itemsTotal) : itemsTotal;
    const discount = itemsTotal.subtract(payable);
    return {
      itemsTotalCents: itemsTotal.toDbCents(),
      discountCents: discount.toDbCents(),
      payableCents: payable.toDbCents(),
    };
  }

  /** 组装预览响应（金额分转元）。 */
  toPreviewResponse(
    pricedItems: ManualEntryPricedItem[],
    amounts: ManualEntryAmounts,
  ): ManualEntryPreviewResponse {
    const previewItems: ManualEntryPreviewItem[] = pricedItems.map((item) => ({
      productId: item.menuProductId,
      productName: item.productName,
      specNames: item.specNames,
      unitPrice: Money.fromDbCents(item.unitPriceCents).toOutputYuan(),
      quantity: item.quantity,
      lineTotal: Money.fromDbCents(item.lineTotalCents).toOutputYuan(),
    }));
    return {
      items: previewItems,
      itemsTotal: Money.fromDbCents(amounts.itemsTotalCents).toOutputYuan(),
      discountAmount: Money.fromDbCents(amounts.discountCents).toOutputYuan(),
      payableAmount: Money.fromDbCents(amounts.payableCents).toOutputYuan(),
    };
  }

  /** 单行定价：商品有效性 + 售罄 + 库存 + 规格选择校验，并计算组合单价。 */
  private priceItem(
    item: ManualEntryItemDto,
    product: NonNullable<
      Awaited<ReturnType<ManualEntryPricingService['loadProduct']>>
    >,
  ): ManualEntryPricedItem {
    const inventoryProduct = product.product;
    if (!product.isActive) {
      throw new BadRequestException(`商品【${product.name}】已下架，无法录入`);
    }
    if (
      inventoryProduct &&
      (!inventoryProduct.isActive || inventoryProduct.deletedAt)
    ) {
      throw new BadRequestException(`商品【${product.name}】已下架，无法录入`);
    }
    if (product.stockMode === 'sold_out') {
      throw new BadRequestException(`商品【${product.name}】已售罄，无法录入`);
    }
    if (product.stockMode === 'finite') {
      // 与 C 端点餐同口径：有关联商品库商品时以商品库库存为准
      const baseStock = inventoryProduct
        ? inventoryProduct.stock
        : (product.stockQuantity ?? 0);
      const availableStock = baseStock - (product.reservedQuantity ?? 0);
      if (availableStock < item.quantity) {
        throw new BadRequestException(`商品【${product.name}】库存不足`);
      }
    }

    const selectedIds = new Set(item.specOptionIds ?? []);
    const selectedSpecs = product.specGroups.flatMap((group) =>
      group.options
        .filter((option) => selectedIds.has(option.id))
        .map((option) => ({
          id: option.id,
          name: option.name,
          extraPrice: option.extraPrice,
        })),
    );
    if (selectedSpecs.length !== selectedIds.size) {
      throw new BadRequestException(
        `商品【${product.name}】规格已更新，请重新选择`,
      );
    }
    this.ensureValidSpecificationSelection(product, selectedIds);

    const basePriceMoney = Money.fromDbCents(product.basePrice);
    const specExtraMoney = selectedSpecs.reduce<Money>(
      (sum, spec) => sum.add(Money.fromDbCents(spec.extraPrice)),
      Money.zero(),
    );
    const unitPriceMoney = basePriceMoney.add(specExtraMoney);
    const lineTotalMoney = unitPriceMoney.multiply(item.quantity);
    const specNames = selectedSpecs.map((spec) => spec.name);

    return {
      menuProductId: product.id,
      productName: product.name,
      categoryId: product.category.id,
      categoryName: product.category.name,
      inventoryProductId: inventoryProduct?.id ?? null,
      specOptionIds: [...selectedIds].sort((a, b) => a - b),
      specNames,
      displayName: specNames.length
        ? `${product.name}（${specNames.join('/')}）`
        : product.name,
      basePriceCents: product.basePrice,
      unitPriceCents: unitPriceMoney.toDbCents(),
      quantity: item.quantity,
      lineTotalCents: lineTotalMoney.toDbCents(),
    };
  }

  /** 规格组选择数量校验：每组已选数必须满足 min/maxSelections（与 C 端同口径）。 */
  private ensureValidSpecificationSelection(
    product: {
      name: string;
      specGroups: Array<{
        minSelections: number;
        maxSelections: number | null;
        options: Array<{ id: number }>;
      }>;
    },
    selectedIds: Set<number>,
  ): void {
    for (const group of product.specGroups) {
      const selectedCount = group.options.filter((option) =>
        selectedIds.has(option.id),
      ).length;
      if (
        selectedCount < group.minSelections ||
        (group.maxSelections !== null && selectedCount > group.maxSelections)
      ) {
        throw new BadRequestException(
          `商品【${product.name}】规格选择不完整，请重新选择`,
        );
      }
    }
  }

  /** 加载单个菜单商品（类型辅助：与 priceItems 的 include 形态一致）。 */
  private async loadProduct(menuProductId: number) {
    return this.prisma.scanOrderingMenuProduct.findFirst({
      where: { id: menuProductId },
      include: {
        category: { select: { id: true, name: true } },
        product: {
          select: { id: true, isActive: true, deletedAt: true, stock: true },
        },
        specGroups: {
          where: { isActive: true },
          include: { options: { where: { isActive: true } } },
        },
      },
    });
  }
}
