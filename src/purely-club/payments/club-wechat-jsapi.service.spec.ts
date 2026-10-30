import type { ConfigService } from '@nestjs/config';
import type { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import { ClubWechatPayIdentityService } from './club-wechat-pay-identity.service';
import { ClubWechatJsapiService } from './club-wechat-jsapi.service';

const STORE_PATH = '/v3/pay/transactions/jsapi';
const PARTNER_PATH = '/v3/pay/partner/transactions/jsapi';

describe('ClubWechatJsapiService 下单口径', () => {
  const configState: Record<string, string | boolean> = {
    'wechat.appId': 'wx_club_appid',
    'wechat.payNotifyUrl': 'https://api.example.com/club/callback',
    'wechat.partner.enabled': false,
    'wechat.partner.spMchId': 'SP0001',
    'wechat.partner.spAppId': 'wx_partner_appid',
    'wechat.partner.notifyUrl': 'https://api.example.com/club/callback',
  };
  const configService = { get: jest.fn((key: string) => configState[key]) };
  const storesService = {
    getWechatPayConfigForStore: jest.fn(),
  };
  const httpService = {
    loadPrivateKeyPem: jest.fn(),
    request: jest.fn(),
    signWithRsa: jest.fn(),
  };

  const buildService = () =>
    new ClubWechatJsapiService(
      storesService as unknown as StoresWechatPayService,
      httpService as unknown as ClubWechatPayHttpService,
      new ClubWechatPayIdentityService(
        configService as unknown as ConfigService,
        storesService as unknown as StoresWechatPayService,
      ),
    );

  const orderRequest = {
    storeId: 1,
    orderNo: 'RC202610291200000001',
    description: '会员充值',
    amountFen: 1,
    openid: 'oOPENID',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configState['wechat.partner.enabled'] = false;
    storesService.getWechatPayConfigForStore.mockResolvedValue({
      mchId: 'STORE_MCH',
      mchName: '示例门店',
      apiV3Key: 'plain-key',
      subMchId: 'SUB0001',
      bindStatus: 'pending',
      configuredAt: null,
    });
    httpService.loadPrivateKeyPem.mockResolvedValue('PEM');
    httpService.request.mockResolvedValue({
      ok: true,
      status: 200,
      data: { prepay_id: 'wx_prepay_001' },
    });
    httpService.signWithRsa.mockReturnValue('SIGN');
  });

  it('直连模式走原生的 transactions/jsapi，body 用 appid/mchid/openid', async () => {
    await buildService().createJsapiPaymentParams(orderRequest);

    const call = httpService.request.mock.calls[0][0];
    expect(call.urlPath).toBe(STORE_PATH);
    expect(call.mchId).toBe('STORE_MCH');
    expect(call.credential).toBe('store');
    expect(JSON.parse(call.body)).toEqual({
      appid: 'wx_club_appid',
      mchid: 'STORE_MCH',
      description: '会员充值',
      out_trade_no: orderRequest.orderNo,
      notify_url: 'https://api.example.com/club/callback',
      amount: { total: 1, currency: 'CNY' },
      payer: { openid: 'oOPENID' },
    });
  });

  it('服务商模式走 partner/transactions/jsapi，body 用 sp_appid/sp_mchid/sub_mchid/sp_openid', async () => {
    configState['wechat.partner.enabled'] = true;

    await buildService().createJsapiPaymentParams(orderRequest);

    const call = httpService.request.mock.calls[0][0];
    expect(call.urlPath).toBe(PARTNER_PATH);
    expect(call.mchId).toBe('SP0001');
    expect(call.credential).toBe('partner');
    expect(JSON.parse(call.body)).toEqual({
      sp_appid: 'wx_partner_appid',
      sp_mchid: 'SP0001',
      sub_mchid: 'SUB0001',
      description: '会员充值',
      out_trade_no: orderRequest.orderNo,
      notify_url: 'https://api.example.com/club/callback',
      amount: { total: 1, currency: 'CNY' },
      payer: { sp_openid: 'oOPENID' },
    });
  });

  it('paySign 的 appId 必须与下单使用的 appid 一致，否则小程序会被微信拒绝', async () => {
    await buildService().createJsapiPaymentParams(orderRequest);
    expect(httpService.signWithRsa.mock.calls[0][0]).toContain('wx_club_appid');

    jest.clearAllMocks();
    httpService.loadPrivateKeyPem.mockResolvedValue('PEM');
    httpService.request.mockResolvedValue({
      ok: true,
      status: 200,
      data: { prepay_id: 'wx_prepay_002' },
    });
    httpService.signWithRsa.mockReturnValue('SIGN');
    configState['wechat.partner.enabled'] = true;

    await buildService().createJsapiPaymentParams(orderRequest);
    expect(httpService.signWithRsa.mock.calls[0][0]).toContain(
      'wx_partner_appid',
    );
  });

  it('服务商模式下即使门店没有 APIv3 密钥也允许下单（子商户本就没有密钥）', async () => {
    configState['wechat.partner.enabled'] = true;
    storesService.getWechatPayConfigForStore.mockResolvedValue({
      mchId: 'STORE_MCH',
      mchName: '示例门店',
      apiV3Key: null,
      subMchId: 'SUB0001',
      bindStatus: 'pending',
      configuredAt: null,
    });

    await expect(
      buildService().createJsapiPaymentParams(orderRequest),
    ).resolves.toEqual(
      expect.objectContaining({ package: 'prepay_id=wx_prepay_001' }),
    );
  });

  it('门店未配置门店商户号时拒绝下单，且不回落到平台商户号', async () => {
    storesService.getWechatPayConfigForStore.mockResolvedValue({
      mchId: null,
      mchName: null,
      apiV3Key: null,
      subMchId: null,
      bindStatus: null,
      configuredAt: null,
    });

    await expect(buildService().assertStorePayConfigured(1)).rejects.toThrow(
      '该门店暂不支持在线充值',
    );
  });
});
