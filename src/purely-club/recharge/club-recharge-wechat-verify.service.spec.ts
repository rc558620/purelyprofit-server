import { RedisService } from '../../redis/redis.service';
import { AlertService } from '../../shared/alert/alert.service';
import { ClubWechatTransactionService } from '../payments/club-wechat-transaction.service';
import { ClubRechargePaymentService } from './club-recharge-payment.service';
import { ClubRechargeQueryService } from './club-recharge-query.service';
import { ClubRechargeWechatVerifyService } from './club-recharge-wechat-verify.service';

/** 待确认充值草稿桩：默认本地仍停在 pending */
const createDraft = (overrides?: Record<string, unknown>) => ({
  id: 'RC202606101231000001A2B',
  orderNo: 'RC202606101231000001A2B',
  orderType: 'recharge' as const,
  status: 'pending' as const,
  storeId: 11,
  userId: 201,
  phone: '13800138000',
  customerId: 36,
  title: '会员充值',
  amountFen: 50000,
  paymentChannel: 'wechat' as const,
  createdAtMs: Date.now(),
  expiresAtMs: Date.now() + 900000,
  paidAtMs: null,
  paymentTransactionId: null,
  callbackReceivedAtMs: null,
  paymentConfirmationSource: null,
  failureReason: null,
  paymentParams: undefined,
  metadata: {
    packageId: '18',
    promotionId: 18,
    rechargeAmountFen: 50000,
    bonusAmountFen: 0,
    customAmountFen: null,
  },
  ...overrides,
});

describe('ClubRechargeWechatVerifyService', () => {
  const redisService = {
    setIfAbsent: jest.fn().mockResolvedValue(true),
  };
  const alertService = { send: jest.fn().mockResolvedValue(undefined) };
  const transactionService = { queryByOutTradeNo: jest.fn() };
  const clubRechargeQueryService = {
    getRechargeDraftByOrderNo: jest.fn(),
    toRechargeOrderResponse: jest.fn(
      (draft: { id: string; status: string }) => ({
        id: draft.id,
        status: draft.status,
      }),
    ),
  };
  const clubRechargePaymentService = {
    confirmOrderPaidByCallback: jest.fn(),
  };

  let service: ClubRechargeWechatVerifyService;

  beforeEach(() => {
    jest.clearAllMocks();
    redisService.setIfAbsent.mockResolvedValue(true);
    alertService.send.mockResolvedValue(undefined);
    clubRechargeQueryService.getRechargeDraftByOrderNo.mockResolvedValue(
      createDraft(),
    );

    service = new ClubRechargeWechatVerifyService(
      redisService as unknown as RedisService,
      alertService as unknown as AlertService,
      transactionService as unknown as ClubWechatTransactionService,
      clubRechargeQueryService as unknown as ClubRechargeQueryService,
      clubRechargePaymentService as unknown as ClubRechargePaymentService,
    );
  });

  it('微信侧已支付时按微信金额补落账', async () => {
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: true,
      snapshot: {
        tradeState: 'SUCCESS',
        amountFen: 50000,
        transactionId: 'wxTx123',
        paidAtMs: 1773558663000,
      },
    });
    clubRechargePaymentService.confirmOrderPaidByCallback.mockResolvedValue({
      id: 'RC202606101231000001A2B',
      status: 'paid',
    });

    await expect(
      service.verifyAndSettle({ orderNo: 'RC202606101231000001A2B' }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'RC202606101231000001A2B',
        status: 'paid',
      }),
    );

    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).toHaveBeenCalledWith(
      'RC202606101231000001A2B',
      expect.objectContaining({
        amountFen: 50000,
        transactionId: 'wxTx123',
      }),
    );
  });

  it('微信侧未支付时不落账，保持本地状态', async () => {
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: true,
      snapshot: { tradeState: 'NOTPAY', amountFen: 50000, transactionId: null },
    });

    await expect(
      service.verifyAndSettle({ orderNo: 'RC202606101231000001A2B' }),
    ).resolves.toEqual(expect.objectContaining({ status: 'pending' }));

    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
  });

  // 金额不一致宁可留人工，也绝不按错误金额加余额
  it('微信侧金额与本地不一致时告警且不落账', async () => {
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: true,
      snapshot: {
        tradeState: 'SUCCESS',
        amountFen: 1,
        transactionId: 'wxTx123',
        paidAtMs: 1773558663000,
      },
    });

    await expect(
      service.verifyAndSettle({ orderNo: 'RC202606101231000001A2B' }),
    ).resolves.toEqual(expect.objectContaining({ status: 'pending' }));

    expect(alertService.send).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
  });

  // 节流：前端 500ms 级轮询不能把微信查单接口打爆
  it('节流窗口内不重复回微信查单', async () => {
    redisService.setIfAbsent.mockResolvedValue(false);

    await expect(
      service.verifyAndSettle({ orderNo: 'RC202606101231000001A2B' }),
    ).resolves.toEqual(expect.objectContaining({ status: 'pending' }));

    expect(transactionService.queryByOutTradeNo).not.toHaveBeenCalled();
  });

  it('force=true 时跳过节流（管理端人工补单）', async () => {
    redisService.setIfAbsent.mockResolvedValue(false);
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: true,
      snapshot: {
        tradeState: 'SUCCESS',
        amountFen: 50000,
        transactionId: 'wxTx123',
        paidAtMs: 1773558663000,
      },
    });
    clubRechargePaymentService.confirmOrderPaidByCallback.mockResolvedValue({
      id: 'RC202606101231000001A2B',
      status: 'paid',
    });

    await service.verifyAndSettle({
      orderNo: 'RC202606101231000001A2B',
      force: true,
    });

    expect(transactionService.queryByOutTradeNo).toHaveBeenCalled();
  });
});
