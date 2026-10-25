// 平台收款统一回调的回归用例：金额对不上或入账失败必须回 FAIL，不能静默丢单
import type { ConfigService } from '@nestjs/config';
import type { ClubPaymentCallbackSignatureService } from '../../purely-club/payments/club-payment-callback-signature.service';
import type { WechatDecryptedTransaction } from '../../purely-club/payments/dto/club-wechat-callback.dto';
import type { NewCustomerQuotaRechargeService } from '../member/new-customer-quota/new-customer-quota-recharge.service';
import type { PlatformMembershipPaymentService } from '../member/platform-membership/platform-membership-payment.service';
import { PlatformPaymentCallbackService } from './platform-payment-callback.service';
import type { PlatformPaymentOrderService } from './platform-payment-order.service';
import type { PlatformWechatCallbackDecryptorService } from './platform-wechat-callback-decryptor.service';

describe('PlatformPaymentCallbackService', () => {
  const signatureService = {
    assertWechatCallbackSignature: jest.fn(),
  };
  const decryptorService = {
    decryptCallback: jest.fn(),
  };
  const paymentOrderService = {
    findByOrderNo: jest.fn(),
  };
  const quotaRechargeService = {
    settleByOrderNo: jest.fn(),
  };
  const membershipPaymentService = {
    activateByPaymentOrderNo: jest.fn(),
  };
  const configService = {
    // 未配置平台商户号时跳过商户号校验，避免影响本地 / 测试环境
    get: jest.fn(() => undefined),
  };

  let service: PlatformPaymentCallbackService;

  const buildDecrypted = (
    overrides: Record<string, unknown> = {},
  ): WechatDecryptedTransaction =>
    ({
      out_trade_no: 'PP20261025000001',
      transaction_id: '4200002500',
      trade_state: 'SUCCESS',
      amount: { total: 9900 },
      ...overrides,
    }) as unknown as WechatDecryptedTransaction;

  const handle = (decrypted: WechatDecryptedTransaction) => {
    decryptorService.decryptCallback.mockReturnValue(decrypted);
    return service.handleCallback({
      rawBody: '{"id":"evt"}',
      headers: {},
      payload: { id: 'evt' },
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    signatureService.assertWechatCallbackSignature.mockReturnValue(undefined);
    paymentOrderService.findByOrderNo.mockResolvedValue({
      orderNo: 'PP20261025000001',
      bizType: 'new_customer_quota',
      amountFen: 9900,
    });
    quotaRechargeService.settleByOrderNo.mockResolvedValue(undefined);
    membershipPaymentService.activateByPaymentOrderNo.mockResolvedValue(
      undefined,
    );

    service = new PlatformPaymentCallbackService(
      signatureService as unknown as ClubPaymentCallbackSignatureService,
      decryptorService as unknown as PlatformWechatCallbackDecryptorService,
      paymentOrderService as unknown as PlatformPaymentOrderService,
      quotaRechargeService as unknown as NewCustomerQuotaRechargeService,
      membershipPaymentService as unknown as PlatformMembershipPaymentService,
      configService as unknown as ConfigService,
    );
  });

  it('验签失败时返回 FAIL 且不解密', async () => {
    signatureService.assertWechatCallbackSignature.mockImplementation(() => {
      throw new Error('签名错误');
    });

    const reply = await handle(buildDecrypted());

    expect(reply.code).toBe('FAIL');
    expect(decryptorService.decryptCallback).not.toHaveBeenCalled();
  });

  it('回调金额与支付单不一致时拒绝入账', async () => {
    const reply = await handle(buildDecrypted({ amount: { total: 1 } }));

    expect(reply).toEqual({
      code: 'FAIL',
      message: '支付金额与订单金额不一致',
    });
    expect(quotaRechargeService.settleByOrderNo).not.toHaveBeenCalled();
    expect(
      membershipPaymentService.activateByPaymentOrderNo,
    ).not.toHaveBeenCalled();
  });

  it('回调缺少支付金额时拒绝入账', async () => {
    const reply = await handle(buildDecrypted({ amount: undefined }));

    expect(reply).toEqual({ code: 'FAIL', message: '回调缺少支付金额' });
    expect(quotaRechargeService.settleByOrderNo).not.toHaveBeenCalled();
  });

  it('金额一致时按业务类型入账并返回 SUCCESS', async () => {
    const reply = await handle(buildDecrypted());

    expect(reply).toEqual({ code: 'SUCCESS' });
    expect(quotaRechargeService.settleByOrderNo).toHaveBeenCalledWith({
      orderNo: 'PP20261025000001',
      transactionId: '4200002500',
      amountFen: 9900,
    });
  });

  it('入账抛错时返回 FAIL 以便微信重投', async () => {
    quotaRechargeService.settleByOrderNo.mockRejectedValue(
      new Error('数据库写入失败'),
    );

    const reply = await handle(buildDecrypted());

    expect(reply).toEqual({ code: 'FAIL', message: '入账处理失败' });
  });

  it('支付单不存在时返回 FAIL', async () => {
    paymentOrderService.findByOrderNo.mockResolvedValue(null);

    const reply = await handle(buildDecrypted());

    expect(reply).toEqual({ code: 'FAIL', message: '支付单不存在' });
  });
});
