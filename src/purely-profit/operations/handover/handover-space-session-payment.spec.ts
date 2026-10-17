import { SalesPaymentMethod } from '@prisma/client';
import { buildSpaceConsumptionPaymentIndex } from './handover-space-session-payment';
import type { OrderItemRow } from './handover.types';

type SessionOverrides = {
  prepaidAmount?: number | null;
  prepaidCustomerPaymentMethod?: string | null;
  prepaidGrouponPlatform?: string | null;
  prepaidGrouponCode?: string | null;
  renewRecords?: Array<{
    paymentMethod: string;
    amount: number;
    renewedAt: bigint;
    grouponPlatform: string | null;
    grouponCode: string | null;
  }>;
};

const buildItem = (
  id: number,
  productName: string,
  salePriceCents: number,
  order: {
    id: number;
    paymentMethod: SalesPaymentMethod;
    grouponCode?: string | null;
  },
  session: SessionOverrides,
): OrderItemRow => ({
  id,
  productName,
  salePrice: salePriceCents,
  quantity: 1,
  product: null,
  order: {
    id: order.id,
    date: new Date('2026-10-17T10:00:00+08:00'),
    paymentMethod: order.paymentMethod,
    manualEntry: false,
    diningMode: null,
    sourceChannel: null,
    grouponCode: order.grouponCode ?? null,
    operatorNameSnapshot: null,
    operatorStaff: null,
    scanOrder: null,
    spaceSession: {
      startTime: new Date('2026-10-17T09:00:00+08:00'),
      sessionItems: [],
      prepaidPaymentMethod: SalesPaymentMethod.alipay,
      prepaidCustomerPaymentMethod:
        session.prepaidCustomerPaymentMethod ?? 'alipay',
      prepaidGrouponPlatform: session.prepaidGrouponPlatform ?? null,
      prepaidGrouponCode: session.prepaidGrouponCode ?? null,
      prepaidAmount: session.prepaidAmount ?? 0,
      sessionRenewRecords: session.renewRecords ?? [],
      space: { name: 'A06' },
      openOperatorNameSnapshot: null,
      openOperatorStaff: null,
    },
  },
});

describe('handover-space-session-payment', () => {
  it('预付款足够覆盖台位费时，台位费与追加点单均使用开台支付方式', () => {
    // 预付 88（淘宝团购）≥ 台位费 1.10 + 追加点单 58
    const items = [
      buildItem(
        1,
        '台位费 1分钟',
        110,
        { id: 1, paymentMethod: SalesPaymentMethod.wechat },
        {
          prepaidAmount: 8800,
          prepaidCustomerPaymentMethod: 'groupon_voucher',
          prepaidGrouponPlatform: 'taobao',
          prepaidGrouponCode: '4564',
        },
      ),
      buildItem(
        2,
        '肩颈热敷',
        5800,
        { id: 1, paymentMethod: SalesPaymentMethod.wechat },
        {
          prepaidAmount: 8800,
          prepaidCustomerPaymentMethod: 'groupon_voucher',
          prepaidGrouponPlatform: 'taobao',
          prepaidGrouponCode: '4564',
        },
      ),
    ];

    const index = buildSpaceConsumptionPaymentIndex(items);

    expect(index.get(1)?.paymentLabel).toBe('淘宝团购');
    expect(index.get(1)?.grouponCode).toBe('4564');
    expect(index.get(2)?.paymentLabel).toBe('淘宝团购');
    expect(index.get(2)?.grouponCode).toBe('4564');
  });

  it('预付款不足、续费补齐时，台位费使用续费支付方式、追加点单使用结账支付方式', () => {
    // 预付 20（微信）+ 续费 40（美团团购）= 60，台位费 44 → 续费补齐
    // 追加点单 158 超出已付 → 结账支付宝补收
    const session: SessionOverrides = {
      prepaidAmount: 2000,
      prepaidCustomerPaymentMethod: 'wechat',
      renewRecords: [
        {
          paymentMethod: 'groupon_voucher',
          amount: 4000,
          renewedAt: 1n,
          grouponPlatform: 'meituan',
          grouponCode: '88888',
        },
      ],
    };
    const items = [
      buildItem(
        1,
        '台位费（固定）',
        4400,
        { id: 1, paymentMethod: SalesPaymentMethod.alipay },
        session,
      ),
      buildItem(
        2,
        '香薰精油按摩',
        15800,
        { id: 1, paymentMethod: SalesPaymentMethod.alipay },
        session,
      ),
    ];

    const index = buildSpaceConsumptionPaymentIndex(items);

    expect(index.get(1)?.paymentLabel).toBe('美团团购');
    expect(index.get(1)?.grouponCode).toBe('88888');
    expect(index.get(2)?.paymentLabel).toBe('支付宝');
  });

  it('预付款与续费均不足时，台位费使用结账支付方式', () => {
    const session: SessionOverrides = {
      prepaidAmount: 2000,
      prepaidCustomerPaymentMethod: 'wechat',
    };
    const items = [
      buildItem(
        1,
        '台位费（固定）',
        4400,
        { id: 1, paymentMethod: SalesPaymentMethod.alipay },
        session,
      ),
    ];

    const index = buildSpaceConsumptionPaymentIndex(items);

    expect(index.get(1)?.paymentMethod).toBe(SalesPaymentMethod.alipay);
    expect(index.get(1)?.paymentLabel).toBe('支付宝');
  });

  it('自助下单行不参与资金冲抵（保持现状展示）', () => {
    // 自助下单 198 由客人在线支付，商品行与抵扣行成对出现
    const session: SessionOverrides = {
      prepaidAmount: 8800,
      prepaidCustomerPaymentMethod: 'alipay',
    };
    const items = [
      buildItem(
        1,
        '台位费（固定）',
        4400,
        { id: 1, paymentMethod: SalesPaymentMethod.cash },
        session,
      ),
      buildItem(
        2,
        '会员体验',
        19800,
        { id: 1, paymentMethod: SalesPaymentMethod.cash },
        session,
      ),
      buildItem(
        3,
        '会员体验 · 自助下单抵扣',
        -19800,
        { id: 1, paymentMethod: SalesPaymentMethod.cash },
        session,
      ),
    ];

    const index = buildSpaceConsumptionPaymentIndex(items);

    expect(index.has(2)).toBe(false);
    expect(index.has(3)).toBe(false);
    expect(index.get(1)?.paymentLabel).toBe('支付宝');
  });

  it('非空间会话订单不产生归属结果', () => {
    const item = buildItem(
      1,
      '招牌水煮鱼',
      6800,
      { id: 1, paymentMethod: SalesPaymentMethod.wechat },
      {},
    );
    const index = buildSpaceConsumptionPaymentIndex([
      { ...item, order: { ...item.order, spaceSession: null } },
    ]);

    expect(index.size).toBe(0);
  });
});
