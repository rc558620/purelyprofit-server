import { Injectable } from '@nestjs/common';
import { Money } from '../../../shared/money.utils';
import type { ScanOrderingAmountSummary } from './scan-ordering.types';

/** 后端价格计算入参，数据库金额均使用分。 */
export interface ScanOrderingPriceInput {
  /** 商品基础价，单位分。 */
  itemOriginalAmountCents: number;
  /** 规格加价，单位分。 */
  specificationExtraAmountCents: number;
  /** 商品级优惠，单位分。 */
  productDiscountAmountCents?: number;
  /** 订单级优惠，单位分。 */
  orderDiscountAmountCents?: number;
  /** 税费，单位分。 */
  taxAmountCents?: number;
  /** 服务费，单位分。 */
  serviceFeeAmountCents?: number;
  /** 已支付金额，单位分。 */
  paidAmountCents?: number;
}

/** 扫码点餐报价与金额汇总唯一计算入口。 */
@Injectable()
export class ScanOrderingPricingService {
  calculateSummary(input: ScanOrderingPriceInput): ScanOrderingAmountSummary {
    const itemOriginalAmount = Money.fromDbCents(input.itemOriginalAmountCents);
    const specificationExtraAmount = Money.fromDbCents(
      input.specificationExtraAmountCents,
    );
    const productDiscountAmount = Money.fromDbCents(
      input.productDiscountAmountCents ?? 0,
    );
    const orderDiscountAmount = Money.fromDbCents(
      input.orderDiscountAmountCents ?? 0,
    );
    const taxAmount = Money.fromDbCents(input.taxAmountCents ?? 0);
    const serviceFeeAmount = Money.fromDbCents(
      input.serviceFeeAmountCents ?? 0,
    );
    const paidAmount = Money.fromDbCents(input.paidAmountCents ?? 0);
    const payableAmount = itemOriginalAmount
      .add(specificationExtraAmount)
      .subtractClampedToZero(productDiscountAmount)
      .subtractClampedToZero(orderDiscountAmount)
      .add(taxAmount)
      .add(serviceFeeAmount);
    const outstandingAmount = payableAmount.subtractClampedToZero(paidAmount);

    return {
      itemOriginalAmount: itemOriginalAmount.toOutputYuan(),
      specificationExtraAmount: specificationExtraAmount.toOutputYuan(),
      productDiscountAmount: productDiscountAmount.toOutputYuan(),
      orderDiscountAmount: orderDiscountAmount.toOutputYuan(),
      taxAmount: taxAmount.toOutputYuan(),
      serviceFeeAmount: serviceFeeAmount.toOutputYuan(),
      payableAmount: payableAmount.toOutputYuan(),
      paidAmount: paidAmount.toOutputYuan(),
      outstandingAmount: outstandingAmount.toOutputYuan(),
      currency: 'CNY',
    };
  }
}
