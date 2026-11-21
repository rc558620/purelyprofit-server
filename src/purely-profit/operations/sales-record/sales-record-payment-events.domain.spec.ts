// 收款 / 退款事件口径：开台预付（券 / 非券）+ 结账补差拆分。
import type { SaleOrderWithItems } from './sales-record.domain';
import { buildSalesRecordPaymentEvents } from './sales-record-payment-events.domain';

interface BuildOrderOverrides {
  voucherFaceAmount?: number | null;
  voucherCode?: string | null;
  voucherPlatform?: string | null;
  customerPaymentMethod?: string | null;
  prepaidAmount?: number | null;
  prepaidPaymentMethod?: string | null;
  prepaidCustomerPaymentMethod?: string | null;
}

const buildOrder = (overrides: BuildOrderOverrides = {}): SaleOrderWithItems =>
  ({
    id: 1,
    storeId: 1,
    // 金额字段只在券口径（grouponVoucherBreakdown）分支被读取，此处默认不触发
    orderNo: '#20261121-001',
    paymentMethod: 'cash',
    customerPaymentMethod: overrides.customerPaymentMethod ?? 'cash',
    voucherCode: overrides.voucherCode ?? null,
    voucherPlatform: overrides.voucherPlatform ?? null,
    voucherFaceAmount: overrides.voucherFaceAmount ?? null,
    grouponPlatform: null,
    refund: null,
    spaceSession: {
      prepaidAmount: overrides.prepaidAmount ?? null,
      prepaidPaymentMethod: overrides.prepaidPaymentMethod ?? null,
      prepaidCustomerPaymentMethod:
        overrides.prepaidCustomerPaymentMethod ?? null,
      sessionRenewRecords: [],
    },
  }) as unknown as SaleOrderWithItems;

describe('buildSalesRecordPaymentEvents 开台预付', () => {
  it('现金开台预付：拆成「开台预付 现金 + 结账 现金」两段', () => {
    const events = buildSalesRecordPaymentEvents(
      buildOrder({
        prepaidAmount: 5500,
        prepaidPaymentMethod: 'cash',
        prepaidCustomerPaymentMethod: 'cash',
      }),
      93,
    );

    expect(events).toEqual([
      { kind: 'prepaid', method: 'cash', amount: 55, direction: 'in' },
      { kind: 'checkout_due', method: 'cash', amount: 38, direction: 'in' },
    ]);
  });

  it('历史脏数据（现金预付被写成券面金额）不会被误判为开台券', () => {
    const events = buildSalesRecordPaymentEvents(
      buildOrder({
        // 无券码 / 券平台、顾客支付方式也不是团购券：券面金额不可信
        voucherFaceAmount: 5500,
        customerPaymentMethod: 'cash',
        prepaidAmount: 5500,
        prepaidPaymentMethod: 'cash',
        prepaidCustomerPaymentMethod: 'cash',
      }),
      93,
    );

    expect(events.map((event) => event.kind)).toEqual([
      'prepaid',
      'checkout_due',
    ]);
    expect(events[0].method).toBe('cash');
  });

  it('团购券开台预付：仍按券面记「开台券」，不重复记预付', () => {
    const events = buildSalesRecordPaymentEvents(
      buildOrder({
        voucherFaceAmount: 5500,
        voucherCode: 'MT1',
        voucherPlatform: 'meituan',
        customerPaymentMethod: 'groupon_voucher',
        prepaidAmount: 5500,
        prepaidPaymentMethod: 'cash',
        prepaidCustomerPaymentMethod: 'groupon_voucher',
      }),
      55,
    );

    expect(events).toEqual([
      {
        kind: 'open_voucher',
        method: 'groupon_voucher',
        platform: 'meituan',
        amount: 55,
        direction: 'in',
      },
    ]);
  });
});
