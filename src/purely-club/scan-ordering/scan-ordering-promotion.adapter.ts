import { Injectable } from '@nestjs/common';
import { ClubMarketingPreviewService } from '../orders/club-marketing-preview.service';
import type { ClubMarketingPreviewResult } from '../orders/club-order-preview.types';
import { ClubScanOrderingMarketingCustomerService } from './club-scan-ordering-marketing-customer.service';
import type { ClubActiveMarketingCustomer } from './club-scan-ordering-marketing-customer.service';

/**
 * 顾客档案定位口径。
 *
 * - `existing`：只读已有档案（购物车预览）。不存在的档案不会被创建，
 *   未建档顾客按「无会员资产」计价（积分 0、消费次数 0）；
 * - `ensure`：允许建档 / 归并（下单、支付落账）。
 */
export type PromotionCustomerLookup = 'existing' | 'ensure';

export interface PromotionAdapterInput {
  storeId: number;
  clubUserId: number;
  items: Array<{
    productId: number;
    quantity: number;
    unitPriceAmount: number;
    specOptionIds: number[];
  }>;
  couponId?: number;
  usePoints: boolean;
  /** 缺省按 `ensure` 处理，只有明确只读的预览路径才传 `existing`。 */
  customerLookup?: PromotionCustomerLookup;
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
  /**
   * 商品级优惠（分），含会员等级折扣。
   * 注：扫码点餐菜单的 unitAmountFen 是 basePrice（原价），不含会员折扣，
   * 因此将 memberDiscountFen 累加到此字段，让落库的行级 payableLineAmount
   * 与订单级 payableAmount 都自然反映会员折扣，避免 calculateSummary 漏算。
   */
  productDiscountAmount: number;
  /** 会员等级折扣（分），单独返回用于营销快照展示。 */
  memberDiscountAmount: number;
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
    private readonly marketingPreviewService: ClubMarketingPreviewService,
  ) {}

  async resolvePromotions(
    input: PromotionAdapterInput,
  ): Promise<PromotionAdapterResult> {
    const customer = await this.lookupCustomer(input);
    const result = await this.marketingPreviewService.previewMarketingLines(
      input.storeId,
      customer?.id ?? null,
      input.clubUserId,
      customer?.phone ?? '',
      input.items.map((item) => ({
        unitAmountFen: item.unitPriceAmount,
        quantity: item.quantity,
      })),
      input.usePoints,
    );
    return this.toPromotionResult(result);
  }

  /**
   * 按口径定位顾客档案。
   *
   * 预览（`existing`）必须走只读路径：该接口每次改购物车都会调用，写库会带来
   * 建档 / 归并事务与行锁争用，而顾客档案本身只在下单或支付落账时才该产生。
   */
  private lookupCustomer(
    input: PromotionAdapterInput,
  ): Promise<ClubActiveMarketingCustomer | null> {
    if (input.customerLookup === 'existing') {
      return this.marketingCustomerService.findExistingCustomer(
        input.storeId,
        input.clubUserId,
      );
    }
    return this.marketingCustomerService.resolveActiveCustomer(
      input.storeId,
      input.clubUserId,
    );
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
      // 会员折扣累加进商品级优惠，让行级分摊与订单级应付都能反映会员折扣
      productDiscountAmount:
        result.productDiscountAmountFen + result.memberDiscountFen,
      memberDiscountAmount: result.memberDiscountFen,
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
