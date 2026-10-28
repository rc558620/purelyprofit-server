import { AlertService } from '../../shared/alert/alert.service';
import { NewCustomerQuotaRechargeService } from '../member/new-customer-quota/new-customer-quota-recharge.service';
import { PlatformMembershipPaymentService } from '../member/platform-membership/platform-membership-payment.service';
import { PlatformPaymentOrderService } from './platform-payment-order.service';
import { PlatformPaymentRealtimeService } from './platform-payment-realtime.service';
import { PlatformWechatNativeService } from './platform-wechat-native.service';
import { PlatformPaymentReconcileSettlementService } from './platform-payment-reconcile-settlement.service';
import type { PendingPaymentOrder } from './platform-payment-reconcile-settlement.service';

describe('PlatformPaymentReconcileSettlementService', () => {
  const MEMBERSHIP_ORDER_NO = 'PM202610290258172260A281A33C';
  const QUOTA_ORDER_NO = 'PQ202610290258172260B112233';
  const TRANSACTION_ID = '4200000000000000000000000000';

  const buildPending = (
    overrides: Partial<PendingPaymentOrder> = {},
  ): PendingPaymentOrder => ({
    orderNo: MEMBERSHIP_ORDER_NO,
    bizType: 'membership',
    amountFen: 1,
    expiresAt: new Date(Date.now() - 60 * 1000),
    ...overrides,
  });

  const buildSnapshot = (
    overrides: Partial<{
      tradeState: 'SUCCESS';
      transactionId: string | null;
      amountFen: number | null;
      paidAt: Date | null;
    }> = {},
  ) => ({
    tradeState: 'SUCCESS' as const,
    transactionId: TRANSACTION_ID,
    amountFen: 1,
    paidAt: new Date('2026-10-28T10:59:00.000Z'),
    ...overrides,
  });

  const alertService = { send: jest.fn().mockResolvedValue(undefined) };
  const nativeService = { closeNativeOrder: jest.fn() };
  const paymentOrderService = { markClosed: jest.fn().mockResolvedValue(true) };
  const realtimeService = {
    publishPaid: jest.fn(),
    publishClosed: jest.fn(),
  };
  const quotaRechargeService = {
    settleByOrderNo: jest.fn().mockResolvedValue(undefined),
  };
  const membershipPaymentService = {
    activateByPaymentOrderNo: jest.fn().mockResolvedValue(undefined),
  };

  let service: PlatformPaymentReconcileSettlementService;

  beforeEach(() => {
    jest.clearAllMocks();
    alertService.send.mockResolvedValue(undefined);
    nativeService.closeNativeOrder.mockResolvedValue('closed');
    paymentOrderService.markClosed.mockResolvedValue(true);

    service = new PlatformPaymentReconcileSettlementService(
      alertService as unknown as AlertService,
      nativeService as unknown as PlatformWechatNativeService,
      paymentOrderService as unknown as PlatformPaymentOrderService,
      realtimeService as unknown as PlatformPaymentRealtimeService,
      quotaRechargeService as unknown as NewCustomerQuotaRechargeService,
      membershipPaymentService as unknown as PlatformMembershipPaymentService,
    );
  });

  it('会员单按 bizType 走会员开通入口并推送 payment.paid', async () => {
    const order = buildPending();
    const snapshot = buildSnapshot();

    await expect(service.settlePaidOrder(order, snapshot)).resolves.toBe(true);

    expect(
      membershipPaymentService.activateByPaymentOrderNo,
    ).toHaveBeenCalledWith({
      paymentOrderNo: MEMBERSHIP_ORDER_NO,
      transactionId: TRANSACTION_ID,
      amountFen: 1,
    });
    expect(realtimeService.publishPaid).toHaveBeenCalledWith(
      MEMBERSHIP_ORDER_NO,
      '2026-10-28T10:59:00.000Z',
    );
    expect(quotaRechargeService.settleByOrderNo).not.toHaveBeenCalled();
  });

  it('额度充值单按 bizType 走额度入账入口并推送 payment.paid', async () => {
    const order = buildPending({
      orderNo: QUOTA_ORDER_NO,
      bizType: 'new_customer_quota',
      amountFen: 3000,
    });
    const snapshot = buildSnapshot({ amountFen: 3000, paidAt: null });

    await expect(service.settlePaidOrder(order, snapshot)).resolves.toBe(true);

    expect(quotaRechargeService.settleByOrderNo).toHaveBeenCalledWith({
      orderNo: QUOTA_ORDER_NO,
      transactionId: TRANSACTION_ID,
      amountFen: 3000,
    });
    expect(
      membershipPaymentService.activateByPaymentOrderNo,
    ).not.toHaveBeenCalled();
    // 微信侧未返回 success_time 时回落为当前时间，保证前端能正常关闭弹窗
    expect(realtimeService.publishPaid).toHaveBeenCalledWith(
      QUOTA_ORDER_NO,
      expect.any(String),
    );
  });

  // 资金安全闸门：金额对不上，一分钱都不能入账
  it('微信金额与本地不一致时不入账，只告警', async () => {
    const order = buildPending();
    const snapshot = buildSnapshot({ amountFen: 9900 });

    await expect(service.settlePaidOrder(order, snapshot)).resolves.toBe(false);

    expect(
      membershipPaymentService.activateByPaymentOrderNo,
    ).not.toHaveBeenCalled();
    expect(quotaRechargeService.settleByOrderNo).not.toHaveBeenCalled();
    expect(realtimeService.publishPaid).not.toHaveBeenCalled();
    expect(alertService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        title: '平台收款对账发现金额不一致',
        suppressKey: `profit-payment-reconcile-amount-mismatch:${MEMBERSHIP_ORDER_NO}`,
      }),
    );
  });

  it('已支付但微信未返回流水号时不入账，只告警', async () => {
    const order = buildPending();
    const snapshot = buildSnapshot({ transactionId: null });

    await expect(service.settlePaidOrder(order, snapshot)).resolves.toBe(false);

    expect(
      membershipPaymentService.activateByPaymentOrderNo,
    ).not.toHaveBeenCalled();
    expect(alertService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        suppressKey: `profit-payment-reconcile-missing-transaction:${MEMBERSHIP_ORDER_NO}`,
      }),
    );
  });

  it('bizType 未接入时只告警，不置任何终态也不推送', async () => {
    const order = buildPending({ bizType: 'sms_recharge' });
    const snapshot = buildSnapshot();

    await expect(service.settlePaidOrder(order, snapshot)).resolves.toBe(false);

    expect(quotaRechargeService.settleByOrderNo).not.toHaveBeenCalled();
    expect(
      membershipPaymentService.activateByPaymentOrderNo,
    ).not.toHaveBeenCalled();
    expect(realtimeService.publishPaid).not.toHaveBeenCalled();
    expect(nativeService.closeNativeOrder).not.toHaveBeenCalled();
    expect(paymentOrderService.markClosed).not.toHaveBeenCalled();
    expect(alertService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '平台收款对账遇到未接入的业务类型',
      }),
    );
  });

  it('未支付且已过期时先关微信侧再关本地单', async () => {
    const order = buildPending();

    await expect(service.closeUnpaidOrder(order)).resolves.toBe(true);

    expect(nativeService.closeNativeOrder).toHaveBeenCalledWith(
      MEMBERSHIP_ORDER_NO,
      'membership',
    );
    expect(paymentOrderService.markClosed).toHaveBeenCalledWith(
      MEMBERSHIP_ORDER_NO,
    );
  });

  it('关单发现微信侧已支付时不关本地单', async () => {
    nativeService.closeNativeOrder.mockResolvedValue('paid');

    await expect(service.closeUnpaidOrder(buildPending())).resolves.toBe(false);

    expect(paymentOrderService.markClosed).not.toHaveBeenCalled();
  });

  it('未支付状态只认 NOTPAY / CLOSED / REVOKED / PAYERROR', () => {
    expect(service.isUnpaid('NOTPAY')).toBe(true);
    expect(service.isUnpaid('CLOSED')).toBe(true);
    expect(service.isUnpaid('REVOKED')).toBe(true);
    expect(service.isUnpaid('PAYERROR')).toBe(true);

    // 结果未定的状态绝不能当未支付：按它关单会误伤已付款的订单
    expect(service.isUnpaid('SUCCESS')).toBe(false);
    expect(service.isUnpaid('REFUND')).toBe(false);
    expect(service.isUnpaid('ACCEPT')).toBe(false);
    expect(service.isUnpaid('UNKNOWN')).toBe(false);
  });
});
