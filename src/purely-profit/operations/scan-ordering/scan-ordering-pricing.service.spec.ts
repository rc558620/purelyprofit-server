import { ScanOrderingPricingService } from './scan-ordering-pricing.service';

describe('ScanOrderingPricingService', () => {
  const service = new ScanOrderingPricingService();

  it('应由后端以分为单位汇总商品、规格、优惠与费用', () => {
    expect(
      service.calculateSummary({
        itemOriginalAmountCents: 2_000,
        specificationExtraAmountCents: 300,
        productDiscountAmountCents: 100,
        orderDiscountAmountCents: 200,
        taxAmountCents: 50,
        serviceFeeAmountCents: 30,
        paidAmountCents: 1_000,
      }),
    ).toEqual({
      itemOriginalAmount: 20,
      specificationExtraAmount: 3,
      productDiscountAmount: 1,
      orderDiscountAmount: 2,
      taxAmount: 0.5,
      serviceFeeAmount: 0.3,
      payableAmount: 20.8,
      paidAmount: 10,
      outstandingAmount: 10.8,
      currency: 'CNY',
    });
  });

  it('优惠不得将应付金额扣减为负数', () => {
    const summary = service.calculateSummary({
      itemOriginalAmountCents: 100,
      specificationExtraAmountCents: 0,
      productDiscountAmountCents: 200,
      orderDiscountAmountCents: 100,
    });

    expect(summary.payableAmount).toBe(0);
    expect(summary.outstandingAmount).toBe(0);
  });
});
