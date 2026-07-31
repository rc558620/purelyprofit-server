import { Injectable } from '@nestjs/common';
import {
  ClubOrderPreviewService,
  type ClubMarketingPreviewResult,
} from '../orders/club-order-preview.service';
import { ClubScanOrderingMarketingCustomerService } from './club-scan-ordering-marketing-customer.service';

export interface PromotionAdapterInput {
  storeId: number;
  clubUserId: number;
  sessionId: number;
  items: Array<{
    productId: number;
    quantity: number;
    unitPriceAmount: number;
    specOptionIds: number[];
  }>;
  couponId?: number;
  usePoints: boolean;
}

export interface PromotionAdapterResult {
  memberBenefits: Array<{ code: string; name: string; discountAmount: number }>;
  availableCoupons: Array<{
    id: number;
    name: string;
    discountAmount: number;
    usable: boolean;
    unusableReason?: string;
  }>;
  appliedPromotions: Array<{
    code: string;
    name: string;
    discountAmount: number;
  }>;
  productDiscountAmount: number;
  orderDiscountAmount: number;
  pointsDeductAmount: number;
  pointsUsed: number;
  afterPointsPayableAmount: number;
  redeemRatioPoints: number;
  availablePoints: number;
  breakdownItems: Array<{
    type:
      | 'item'
      | 'specification'
      | 'membership'
      | 'coupon'
      | 'promotion'
      | 'service_fee'
      | 'tax';
    label: string;
    amount: number;
    isStrikethrough?: boolean;
  }>;
}

@Injectable()
export class ScanOrderingPromotionAdapter {
  constructor(
    private readonly marketingCustomerService: ClubScanOrderingMarketingCustomerService,
    private readonly orderPreviewService: ClubOrderPreviewService,
  ) {}

  async resolvePromotions(
    input: PromotionAdapterInput,
  ): Promise<PromotionAdapterResult> {
    const customer = await this.marketingCustomerService.resolveActiveCustomer(
      input.storeId,
      input.clubUserId,
    );
    const result = await this.orderPreviewService.previewMarketingLines(
      input.storeId,
      customer.id,
      customer.phone ?? '',
      input.items.map((item) => ({
        unitAmountFen: item.unitPriceAmount,
        quantity: item.quantity,
      })),
      input.usePoints,
    );
    return this.toPromotionResult(result);
  }

  private toPromotionResult(
    result: ClubMarketingPreviewResult,
  ): PromotionAdapterResult {
    return {
      memberBenefits: [],
      availableCoupons: [],
      appliedPromotions: result.breakdownItems
        .filter((item) => item.id.startsWith('promotion-'))
        .map((item) => ({
          code: item.id,
          name: item.label,
          discountAmount: Math.abs(this.amountFromDisplayValue(item.value)),
        })),
      productDiscountAmount: result.productDiscountAmountFen,
      orderDiscountAmount: result.orderDiscountAmountFen,
      pointsDeductAmount: result.pointsDeductFen,
      pointsUsed: result.pointsUsed,
      afterPointsPayableAmount: result.afterPointsPriceFen,
      redeemRatioPoints: result.redeemRatioPoints,
      availablePoints: result.availablePoints,
      breakdownItems: result.breakdownItems.map((item) => ({
        type: item.id.startsWith('level-')
          ? 'membership'
          : item.id.startsWith('promotion-')
            ? 'promotion'
            : 'coupon',
        label: item.label,
        amount: this.amountFromDisplayValue(item.value),
        isStrikethrough: item.isStrikethrough,
      })),
    };
  }

  private amountFromDisplayValue(value: string): number {
    const amount = Number(value.replace(/[¥,]/g, ''));
    return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
  }
}
