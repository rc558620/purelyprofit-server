import { Injectable } from '@nestjs/common';

/**
 * 扫码点餐营销适配器输入。
 *
 * 当前仅为兼容层接口定义，当后续接入会员专区营销能力时，
 * 将实际查询会员权益、优惠券、促销活动等数据。
 */
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
}

/**
 * 扫码点餐营销适配器输出。
 *
 * 所有金额均以"分"为单位。
 */
export interface PromotionAdapterResult {
  memberBenefits: Array<{
    code: string;
    name: string;
    discountAmount: number;
  }>;
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
  }>;
}

/**
 * 扫码点餐营销适配器。
 *
 * 设计原则：
 * - 不新建会员、优惠券、促销规则体系；
 * - 不伪造优惠；
 * - 仅作为扫码点餐与未来会员专区营销能力之间的兼容层；
 * - 当前没有可复用营销能力时必须稳定返回空结果；
 * - 所有金额仍以"分"为内部单位。
 *
 * 后续接入：
 * - 当会员专区营销能力就绪后，在此适配器内调用对应的会员权益查询、
 *   优惠券校验、促销规则匹配等服务；
 * - 适配器输出结构保持稳定，新增营销能力只需填充返回数据。
 */
@Injectable()
export class ScanOrderingPromotionAdapter {
  /**
   * 查询当前扫码点餐订单可用的营销优惠。
   *
   * 当前阶段：无可复用营销能力，稳定返回空结果。
   * 所有金额字段为 0，数组字段为空。
   */
  resolvePromotions(
    _input: PromotionAdapterInput,
  ): Promise<PromotionAdapterResult> {
    return Promise.resolve({
      memberBenefits: [],
      availableCoupons: [],
      appliedPromotions: [],
      productDiscountAmount: 0,
      orderDiscountAmount: 0,
      breakdownItems: [],
    });
  }
}
