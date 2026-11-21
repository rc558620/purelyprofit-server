/** 销售列表来源标记：只有同门店、已结账、未退款的空间单才算空间结账单。 */
import { resolveIsSpaceCheckoutOrder } from './sales-record-response.mapping';

type OrderArgs = Parameters<typeof resolveIsSpaceCheckoutOrder>[0];

const buildOrder = ({
  sessionStatus = 'settled',
  sessionStoreId = 18,
  storeId = 18,
  refunded = false,
}: {
  sessionStatus?: string;
  sessionStoreId?: number;
  storeId?: number;
  refunded?: boolean;
} = {}): OrderArgs =>
  ({
    storeId,
    refund: refunded ? { refundedAt: new Date('2026-05-14T11:00:00Z') } : null,
    spaceSession: {
      status: sessionStatus,
      storeId: sessionStoreId,
    },
  }) as unknown as OrderArgs;

describe('resolveIsSpaceCheckoutOrder', () => {
  it('同门店 + 已结账 + 未退款 → true', () => {
    expect(resolveIsSpaceCheckoutOrder(buildOrder())).toBe(true);
  });

  it('无空间会话（手工录单/普通商品/扫码点餐）→ false', () => {
    expect(
      resolveIsSpaceCheckoutOrder({
        ...buildOrder(),
        spaceSession: null,
      } as unknown as OrderArgs),
    ).toBe(false);
  });

  it('会话未结账 → false', () => {
    expect(
      resolveIsSpaceCheckoutOrder(buildOrder({ sessionStatus: 'active' })),
    ).toBe(false);
  });

  it('订单已退款 → false', () => {
    expect(resolveIsSpaceCheckoutOrder(buildOrder({ refunded: true }))).toBe(
      false,
    );
  });

  it('会话门店与订单门店不一致 → false', () => {
    expect(
      resolveIsSpaceCheckoutOrder(buildOrder({ sessionStoreId: 99 })),
    ).toBe(false);
  });
});
