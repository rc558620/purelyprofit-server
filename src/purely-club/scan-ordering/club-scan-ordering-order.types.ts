import type { PromotionAdapterResult } from './scan-ordering-promotion.adapter';

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
