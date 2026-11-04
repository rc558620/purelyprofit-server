import { ClubWechatVerifyService } from '../payments/club-wechat-verify.service';
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
  const clubWechatVerifyService = {
    confirmPaidOnWechat: jest.fn(),
  };
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
    clubRechargeQueryService.getRechargeDraftByOrderNo.mockResolvedValue(
      createDraft(),
    );

    service = new ClubRechargeWechatVerifyService(
      clubWechatVerifyService as unknown as ClubWechatVerifyService,
      clubRechargeQueryService as unknown as ClubRechargeQueryService,
      clubRechargePaymentService as unknown as ClubRechargePaymentService,
    );
  });

  // 核对逻辑（节流 / 查单 / 金额与流水号校验 / 告警）统一由基类实现，
  // 本服务只负责把充值草稿翻译成核对入参
  it('把充值草稿翻译成核对入参（scope=recharge）', async () => {
    clubWechatVerifyService.confirmPaidOnWechat.mockResolvedValue(null);

    await service.verifyAndSettle({ orderNo: 'RC202606101231000001A2B' });

    expect(clubWechatVerifyService.confirmPaidOnWechat).toHaveBeenCalledWith({
      scope: 'recharge',
      storeId: 11,
      outTradeNo: 'RC202606101231000001A2B',
      expectedAmountFen: 50000,
      force: undefined,
    });
  });

  it('核对通过时按微信快照补落账', async () => {
    clubWechatVerifyService.confirmPaidOnWechat.mockResolvedValue({
      amountFen: 50000,
      transactionId: 'wxTx123',
      paidAtMs: 1773558663000,
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
        paidAtMs: 1773558663000,
        callbackReceivedAtMs: expect.any(Number),
      }),
    );
  });

  // 未支付 / 查不到 / 金额不一致 / 节流命中统一返回 null：一律保持本地状态
  it('核对未通过时保持本地状态且不落账', async () => {
    clubWechatVerifyService.confirmPaidOnWechat.mockResolvedValue(null);

    await expect(
      service.verifyAndSettle({ orderNo: 'RC202606101231000001A2B' }),
    ).resolves.toEqual(expect.objectContaining({ status: 'pending' }));

    expect(
      clubRechargePaymentService.confirmOrderPaidByCallback,
    ).not.toHaveBeenCalled();
  });

  it('已支付订单不再回微信核对', async () => {
    clubRechargeQueryService.getRechargeDraftByOrderNo.mockResolvedValue(
      createDraft({ status: 'paid' }),
    );

    await expect(
      service.verifyAndSettle({ orderNo: 'RC202606101231000001A2B' }),
    ).resolves.toEqual(expect.objectContaining({ status: 'paid' }));

    expect(clubWechatVerifyService.confirmPaidOnWechat).not.toHaveBeenCalled();
  });

  it('force=true 透传给核对服务（管理端人工补单）', async () => {
    clubWechatVerifyService.confirmPaidOnWechat.mockResolvedValue(null);

    await service.verifyAndSettle({
      orderNo: 'RC202606101231000001A2B',
      force: true,
    });

    expect(clubWechatVerifyService.confirmPaidOnWechat).toHaveBeenCalledWith(
      expect.objectContaining({ force: true }),
    );
  });
});
