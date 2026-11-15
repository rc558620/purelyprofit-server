import { ScanOrderingPromotionAdapter } from './scan-ordering-promotion.adapter';
import type { PromotionAdapterInput } from './scan-ordering-promotion.adapter';
import type { ClubScanOrderingMarketingCustomerService } from './club-scan-ordering-marketing-customer.service';
import type { ClubMarketingPreviewService } from '../orders/club-marketing-preview.service';
import type { ClubMarketingPreviewResult } from '../orders/club-order-preview.types';

/**
 * 顾客档案定位口径的契约测试：预览（`existing`）必须只读，下单（`ensure`）
 * 才允许建档。并发正确性由真实库 e2e
 * （test/club-scan-ordering-preview-readonly.e2e-spec.ts）覆盖。
 */
describe('ScanOrderingPromotionAdapter 顾客档案定位口径', () => {
  const basePreviewResult: ClubMarketingPreviewResult = {
    productDiscountAmountFen: 0,
    orderDiscountAmountFen: 0,
    memberDiscountFen: 0,
    payableAmountFen: 1000,
    pointsDeductFen: 0,
    pointsUsed: 0,
    afterPointsPriceFen: 1000,
    redeemRatioPoints: 100,
    availablePoints: 0,
    breakdownItems: [],
  };

  const baseInput: PromotionAdapterInput = {
    storeId: 11,
    clubUserId: 7001,
    items: [
      { productId: 1, quantity: 1, unitPriceAmount: 1000, specOptionIds: [] },
    ],
    usePoints: false,
  };

  const createAdapter = (
    marketingCustomerService: Partial<ClubScanOrderingMarketingCustomerService>,
    marketingPreviewService: Partial<ClubMarketingPreviewService>,
  ): ScanOrderingPromotionAdapter =>
    new ScanOrderingPromotionAdapter(
      marketingCustomerService as ClubScanOrderingMarketingCustomerService,
      marketingPreviewService as ClubMarketingPreviewService,
    );

  it('预览口径只读定位，未建档顾客按无会员资产计价', async () => {
    const findExistingCustomer = jest.fn().mockResolvedValue(null);
    const resolveActiveCustomer = jest.fn();
    const previewMarketingLines = jest
      .fn()
      .mockResolvedValue(basePreviewResult);
    const adapter = createAdapter(
      { findExistingCustomer, resolveActiveCustomer },
      { previewMarketingLines },
    );

    const result = await adapter.resolvePromotions({
      ...baseInput,
      customerLookup: 'existing',
    });

    expect(findExistingCustomer).toHaveBeenCalledWith(11, 7001);
    expect(resolveActiveCustomer).not.toHaveBeenCalled();
    // customerId 传 null → 定价按「消费次数 0、积分 0」处理
    expect(previewMarketingLines).toHaveBeenCalledWith(
      11,
      null,
      7001,
      '',
      [{ unitAmountFen: 1000, quantity: 1 }],
      false,
    );
    expect(result.availablePoints).toBe(0);
  });

  it('下单口径允许建档，并把档案 id / 手机号透传给预览计价', async () => {
    const findExistingCustomer = jest.fn();
    const resolveActiveCustomer = jest
      .fn()
      .mockResolvedValue({ id: 9001, balance: 0, phone: '13800000009' });
    const previewMarketingLines = jest
      .fn()
      .mockResolvedValue(basePreviewResult);
    const adapter = createAdapter(
      { findExistingCustomer, resolveActiveCustomer },
      { previewMarketingLines },
    );

    await adapter.resolvePromotions({ ...baseInput, customerLookup: 'ensure' });

    expect(resolveActiveCustomer).toHaveBeenCalledWith(11, 7001);
    expect(findExistingCustomer).not.toHaveBeenCalled();
    expect(previewMarketingLines).toHaveBeenCalledWith(
      11,
      9001,
      7001,
      '13800000009',
      [{ unitAmountFen: 1000, quantity: 1 }],
      false,
    );
  });
});
