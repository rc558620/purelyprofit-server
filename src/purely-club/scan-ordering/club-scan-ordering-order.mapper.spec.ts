import {
  computeOrderDiscountAmountFen,
  fenToYuan,
  toOrderAmountSummary,
} from './club-scan-ordering-order.mapper';

describe('club-scan-ordering-order.mapper', () => {
  describe('computeOrderDiscountAmountFen', () => {
    it('商品优惠 10 元、订单优惠 5 元、积分抵扣 3 元，返回 18 元', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 14300,
          specificationExtraAmount: 0,
          productDiscountAmount: 1000,
          orderDiscountAmount: 500,
          payableAmount: 12500,
          marketingSnapshot: { pointsDeductAmount: 300 },
        }),
      ).toBe(1800);
    });

    it('只有商品优惠', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          productDiscountAmount: 1000,
          orderDiscountAmount: 0,
          payableAmount: 9000,
          marketingSnapshot: null,
        }),
      ).toBe(1000);
    });

    it('只有订单优惠', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          productDiscountAmount: 0,
          orderDiscountAmount: 200,
          payableAmount: 9800,
          marketingSnapshot: { pointsDeductAmount: 0 },
        }),
      ).toBe(200);
    });

    it('只有积分抵扣', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          payableAmount: 9650,
          marketingSnapshot: { pointsDeductAmount: 350 },
        }),
      ).toBe(350);
    });

    it('会员等级折扣（未写入 productDiscount/orderDiscount）也能正确捕获', () => {
      // 48 元商品 8 折 = 38.4 元应付，节省 9.6 元（会员折扣未写入优惠字段）
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 4800,
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          payableAmount: 3840,
          marketingSnapshot: null,
        }),
      ).toBe(960);
    });

    it('优惠券（未写入 productDiscount/orderDiscount）也能正确捕获', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          payableAmount: 9000,
          marketingSnapshot: null,
        }),
      ).toBe(1000);
    });

    it('会员折扣叠加积分抵扣', () => {
      // 原价 4800，会员 8 折 3840，再抵扣 500 积分 → 应付 3340 → 优惠 1460
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 4800,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          payableAmount: 3340,
          marketingSnapshot: { pointsDeductAmount: 500 },
        }),
      ).toBe(1460);
    });

    it('没有任何优惠，返回 0', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          payableAmount: 10000,
          marketingSnapshot: { pointsDeductAmount: 0 },
        }),
      ).toBe(0);
    });

    it('marketingSnapshot 为 null 时按 0 处理', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          productDiscountAmount: 300,
          orderDiscountAmount: 200,
          payableAmount: 9500,
          marketingSnapshot: null,
        }),
      ).toBe(500);
    });

    it('marketingSnapshot 缺少 pointsDeductAmount 时按 0 处理', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          productDiscountAmount: 300,
          orderDiscountAmount: 200,
          payableAmount: 9500,
          marketingSnapshot: { usePoints: false },
        }),
      ).toBe(500);
    });

    it('积分抵扣字段为字符串时按 0 处理', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          productDiscountAmount: 300,
          orderDiscountAmount: 0,
          payableAmount: 9700,
          marketingSnapshot: { pointsDeductAmount: '300' },
        }),
      ).toBe(300);
    });

    it('积分抵扣字段为负数时按 0 处理', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          productDiscountAmount: 300,
          orderDiscountAmount: 0,
          payableAmount: 9700,
          marketingSnapshot: { pointsDeductAmount: -300 },
        }),
      ).toBe(300);
    });

    it('优惠字段为 null 时按 0 处理', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          productDiscountAmount: null,
          orderDiscountAmount: null,
          payableAmount: 10000,
          marketingSnapshot: null,
        }),
      ).toBe(0);
    });

    it('payableAmount 缺失但加法公式有值时，回退到加法公式', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          productDiscountAmount: 300,
          orderDiscountAmount: 0,
          marketingSnapshot: null,
        }),
      ).toBe(300);
    });

    it('优惠金额超过商品原价 + 规格加价时封顶', () => {
      // payable 缺失 → subtractive=0；additive=15000 封顶到 10500
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          specificationExtraAmount: 500,
          productDiscountAmount: 9000,
          orderDiscountAmount: 5000,
          marketingSnapshot: { pointsDeductAmount: 1000 },
        }),
      ).toBe(10500);
    });

    it('订单金额为 0 时返回 0', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 0,
          specificationExtraAmount: 0,
          productDiscountAmount: 0,
          orderDiscountAmount: 0,
          payableAmount: 0,
          marketingSnapshot: { pointsDeductAmount: 0 },
        }),
      ).toBe(0);
    });

    it('规格加价计入可优惠上限', () => {
      expect(
        computeOrderDiscountAmountFen({
          itemOriginalAmount: 10000,
          specificationExtraAmount: 2000,
          productDiscountAmount: 12000,
          orderDiscountAmount: 0,
          payableAmount: 0,
          marketingSnapshot: null,
        }),
      ).toBe(12000);
    });
  });

  describe('toOrderAmountSummary', () => {
    it('输出金额统一为元并包含 discountAmount', () => {
      const summary = toOrderAmountSummary({
        itemOriginalAmount: 14300,
        specificationExtraAmount: 400,
        productDiscountAmount: 1000,
        orderDiscountAmount: 500,
        payableAmount: 12850,
        paidAmount: 12850,
        marketingSnapshot: { pointsDeductAmount: 350 },
      });
      expect(summary).toEqual({
        itemOriginalAmount: 143,
        specificationExtraAmount: 4,
        productDiscountAmount: 10,
        orderDiscountAmount: 5,
        pointsDeductAmount: 3.5,
        discountAmount: 18.5,
        payableAmount: 128.5,
        paidAmount: 128.5,
        discountItems: [],
      });
    });

    it('会员折扣订单正确输出 discountAmount', () => {
      const summary = toOrderAmountSummary({
        itemOriginalAmount: 4800,
        productDiscountAmount: 0,
        orderDiscountAmount: 0,
        payableAmount: 3840,
        paidAmount: 3840,
        marketingSnapshot: null,
      });
      expect(summary.discountAmount).toBe(9.6);
      expect(summary.payableAmount).toBe(38.4);
    });

    it('无优惠订单 discountAmount 为 0', () => {
      const summary = toOrderAmountSummary({
        itemOriginalAmount: 8000,
        specificationExtraAmount: 0,
        productDiscountAmount: 0,
        orderDiscountAmount: 0,
        payableAmount: 8000,
        paidAmount: 8000,
        marketingSnapshot: null,
      });
      expect(summary.discountAmount).toBe(0);
    });

    it('订单已退款时仍保留原优惠金额', () => {
      const summary = toOrderAmountSummary({
        itemOriginalAmount: 8000,
        specificationExtraAmount: 0,
        productDiscountAmount: 1000,
        orderDiscountAmount: 500,
        payableAmount: 6300,
        paidAmount: 0,
        marketingSnapshot: { pointsDeductAmount: 200 },
      });
      expect(summary.discountAmount).toBe(17);
      expect(summary.paidAmount).toBe(0);
    });

    it('缺失字段按 0 处理且不会抛异常', () => {
      const summary = toOrderAmountSummary({});
      expect(summary).toEqual({
        itemOriginalAmount: 0,
        specificationExtraAmount: 0,
        productDiscountAmount: 0,
        orderDiscountAmount: 0,
        pointsDeductAmount: 0,
        discountAmount: 0,
        payableAmount: 0,
        paidAmount: 0,
        discountItems: [],
      });
    });
  });

  describe('fenToYuan', () => {
    it.each([
      [0, 0],
      [1, 0.01],
      [99, 0.99],
      [101, 1.01],
      [1850, 18.5],
      [12550, 125.5],
      [null, 0],
      [undefined, 0],
    ])('%p 分转换为 %p 元', (cents, expected) => {
      expect(fenToYuan(cents as number | null | undefined)).toBe(expected);
    });
  });
});
