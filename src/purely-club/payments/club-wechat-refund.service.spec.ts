// 微信退款服务单测：重点守住「退款必须回到原收款主体」与「订单归属」两条资金边界
import { ForbiddenException } from '@nestjs/common';
import { ClubPaymentOrderRecordService } from './club-payment-order-record.service';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import { ClubWechatPayIdentityService } from './club-wechat-pay-identity.service';
import { ClubWechatRefundService } from './club-wechat-refund.service';

describe('ClubWechatRefundService', () => {
  const httpService = {
    request: jest.fn(),
    loadPrivateKeyPem: jest.fn(),
    isProduction: jest.fn(),
  };
  const identityService = { resolveTarget: jest.fn() };
  const orderRecordService = { findByOrderNo: jest.fn() };

  const buildService = (): ClubWechatRefundService =>
    new ClubWechatRefundService(
      httpService as unknown as ClubWechatPayHttpService,
      identityService as unknown as ClubWechatPayIdentityService,
      orderRecordService as unknown as ClubPaymentOrderRecordService,
    );

  const partnerTarget = {
    mode: 'partner' as const,
    signMchId: 'SP0001',
    settleMchId: 'SUB_CURRENT',
    appId: 'wxapp',
    notifyUrl: 'https://api.example.com/callback',
  };

  const refundParams = {
    storeId: 1,
    orderNo: 'RC202610301200001234',
    refundNo: 'RF202610301200001234',
    totalFen: 100,
    refundFen: 100,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    httpService.loadPrivateKeyPem.mockResolvedValue('PEM');
    httpService.isProduction.mockReturnValue(false);
    httpService.request.mockResolvedValue({
      ok: true,
      status: 200,
      data: { refund_id: 'wx-refund-1' },
    });
    identityService.resolveTarget.mockResolvedValue(partnerTarget);
  });

  it('订单不属于当前门店时拒绝退款（防止拿别家订单号退别家商户的钱）', async () => {
    orderRecordService.findByOrderNo.mockResolvedValue({
      kind: 'recharge',
      storeId: 2,
      spMchId: 'SP0001',
      subMchId: 'SUB_OTHER_STORE',
    });

    await expect(buildService().requestRefund(refundParams)).rejects.toThrow(
      ForbiddenException,
    );
    // 关键：签名请求一次都不能发出——服务商模式下签名主体是同一个 sp_mchid，
    // 微信侧拦不住这种越权，只能在本地拦
    expect(httpService.request).not.toHaveBeenCalled();
  });

  it('按订单记录的原收款子商户号退款，签名主体仍是服务商商户号', async () => {
    orderRecordService.findByOrderNo.mockResolvedValue({
      kind: 'recharge',
      storeId: 1,
      spMchId: 'SP0001',
      subMchId: 'SUB_RECORDED',
    });

    await buildService().requestRefund(refundParams);

    const [params] = httpService.request.mock.calls[0];
    expect(params.mchId).toBe('SP0001');
    expect(params.credential).toBe('partner');
    expect(JSON.parse(params.body ?? '{}').sub_mchid).toBe('SUB_RECORDED');
  });

  it('订单无记录时回落到门店当前配置的收款主体', async () => {
    orderRecordService.findByOrderNo.mockResolvedValue(null);

    await buildService().requestRefund(refundParams);

    const [params] = httpService.request.mock.calls[0];
    expect(JSON.parse(params.body ?? '{}').sub_mchid).toBe('SUB_CURRENT');
  });
});
