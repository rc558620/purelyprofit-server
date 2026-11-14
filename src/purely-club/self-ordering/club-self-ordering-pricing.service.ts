// 自助下单商品定价与快照：同商品多行合并 → 服务端权威重算 → 落快照
//
// 从 ClubSelfOrderingOrderService 拆出的原因：定价是「金额口径」，
// 建单是「幂等 + 事务」；两者混在一起时，任何价格规则调整都要在同一段代码里
// 穿过幂等闸门去改，回归面被放大。
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CLUB_SELF_ORDERING_ERROR_CODE,
  clubSelfOrderingError,
} from './club-self-ordering.errors';
import { ProductSpecPricingService } from '../../purely-profit/goods/products/product-spec-pricing.service';
import type { SelfOrderItemInputDto } from './dto/create-self-order.dto';

/** 定价后的订单行（含服务端重算的价格与商品快照） */
export interface PricedSelfOrderItem {
  productId: string;
  productName: string;
  categoryName: string | null;
  /** 销售单价（分） */
  salePrice: number;
  /** 成本单价（分） */
  costPrice: number;
  quantity: number;
  /** 规格签名（选项 ID 升序 sha256）；无规格时为 null */
  specSignature: string | null;
  /** 规格名快照 */
  specNames: string[];
  /** 已选规格选项快照（用于落 self_order_item_specs） */
  specOptions: Array<{ id: number; name: string; extraPrice: number }>;
}

/** 定价结果：自助下单不参与优惠，应付恒等于商品合计 */
export interface SelfOrderPricingResult {
  items: PricedSelfOrderItem[];
  itemTotalAmount: number;
  payableAmount: number;
}

/** 合并行：同商品 + 同规格选项组合 */
interface MergedSelfOrderLine {
  productId: string;
  specOptionIds: number[];
  quantity: number;
}

/** 订单行合并键：同商品 + 同规格选项组合视为同一行（specOptionIds 已去重升序） */
const buildSelfOrderLineKey = (
  productId: string,
  specOptionIds: number[],
): string =>
  specOptionIds.length > 0
    ? `${productId}:${specOptionIds.join('-')}`
    : `${productId}:plain`;

@Injectable()
export class ClubSelfOrderingPricingService {
  constructor(private readonly specPricing: ProductSpecPricingService) {}

  /**
   * 商品定价与快照。
   * 同一商品多行时先合并数量；价格、名称、分类名一律取自商品库当前值并落快照。
   */
  async priceItems(
    storeId: number,
    inputs: SelfOrderItemInputDto[],
  ): Promise<SelfOrderPricingResult> {
    const mergedLines = this.mergeLines(inputs);
    const items: PricedSelfOrderItem[] = [];
    for (const line of mergedLines.values()) {
      items.push(await this.priceLine(storeId, line));
    }

    const itemTotalAmount = items.reduce(
      (sum, item) => sum + item.salePrice * item.quantity,
      0,
    );
    return { items, itemTotalAmount, payableAmount: itemTotalAmount };
  }

  /** 合并键必须含规格：同商品不同规格是不同行，仅按 productId 合并会静默丢规格 */
  private mergeLines(
    inputs: SelfOrderItemInputDto[],
  ): Map<string, MergedSelfOrderLine> {
    const mergedLines = new Map<string, MergedSelfOrderLine>();
    for (const input of inputs) {
      const specOptionIds = [...new Set(input.specOptionIds ?? [])].sort(
        (left, right) => left - right,
      );
      const key = buildSelfOrderLineKey(input.productId, specOptionIds);
      const hit = mergedLines.get(key);
      if (hit) {
        hit.quantity += input.quantity;
        continue;
      }
      mergedLines.set(key, {
        productId: input.productId,
        specOptionIds,
        quantity: input.quantity,
      });
    }
    return mergedLines;
  }

  /** 服务端权威定价：单价 = Product.price + Σ 规格加价，商品名用含规格后缀的展示名 */
  private async priceLine(
    storeId: number,
    line: MergedSelfOrderLine,
  ): Promise<PricedSelfOrderItem> {
    const productId = Number(line.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new NotFoundException(
        clubSelfOrderingError(
          CLUB_SELF_ORDERING_ERROR_CODE.PARAM_CART_ITEM_INVALID,
          '购物车中存在无效商品，请刷新后重试',
        ),
      );
    }

    let priced: Awaited<ReturnType<ProductSpecPricingService['price']>>;
    try {
      priced = await this.specPricing.price({
        storeId,
        productId,
        specOptionIds: line.specOptionIds,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException(
          clubSelfOrderingError(
            CLUB_SELF_ORDERING_ERROR_CODE.RESOURCE_PRODUCT_OFF_SHELF,
            '购物车中存在已下架商品，请刷新后重试',
          ),
        );
      }
      throw error;
    }

    return {
      productId: line.productId,
      productName: priced.displayName,
      categoryName: priced.categoryName,
      salePrice: priced.unitPriceCents,
      costPrice: priced.costPriceCents,
      quantity: line.quantity,
      specSignature: priced.specSignature,
      specNames: priced.specNames,
      specOptions: priced.specOptions,
    };
  }
}
