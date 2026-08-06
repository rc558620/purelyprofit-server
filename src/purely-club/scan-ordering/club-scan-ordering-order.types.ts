import type { PromotionAdapterResult } from './scan-ordering-promotion.adapter';

/**
 * 扫码点餐订单查询接口的统一金额响应（单位：元）。
 * 当前订单列表、历史点餐记录、订单详情三个入口共用同一套金额口径：
 * discountAmount = 商品优惠 + 订单优惠 + 积分抵扣；无优惠时为 0。
 */
export type { OrderAmountSummary as ScanOrderAmountSummary } from './club-scan-ordering-order.mapper';

export interface PricedCartItem {
  cartItemId: number;
  productId: number;
  inventoryProductId: number | null;
  productName: string;
  productImageUrl: string | null;
  categoryName: string;
  quantity: number;
  specSignature: string;
  basePrice: number;
  unitPriceAmount: number;
  lineTotalAmount: number;
  specs: Array<{ specOptionId: number; name: string; extraPrice: number }>;
}

export interface OrderAmountBreakdown {
  itemOriginalAmount: number;
  specificationExtraAmount: number;
  productDiscountAmount: number;
  orderDiscountAmount: number;
  serviceFeeAmount: number;
  taxAmount: number;
  payableAmount: number;
}

export interface PreviewResult {
  sessionId: number;
  guestCount: number;
  remark: string | null;
  cartVersion: number;
  pricingVersion: string;
  itemOriginalAmount: number;
  specificationExtraAmount: number;
  productDiscountAmount: number;
  orderDiscountAmount: number;
  serviceFeeAmount: number;
  taxAmount: number;
  payableAmount: number;
  pointsDeductAmount: number;
  pointsUsed: number;
  afterPointsPayableAmount: number;
  redeemRatioPoints: number;
  availablePoints: number;
  breakdownItems: Array<{
    type: string;
    label: string;
    amount: number;
  }>;
  availableCoupons: PromotionAdapterResult['availableCoupons'];
  appliedPromotions: PromotionAdapterResult['appliedPromotions'];
  items: PricedCartItem[];
}
