import type { ConfigService } from '@nestjs/config';
import type { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';
import { ClubWechatPayHttpService } from './club-wechat-pay-http.service';
import { ClubWechatPayIdentityService } from './club-wechat-pay-identity.service';
import { ClubWechatTransactionService } from './club-wechat-transaction.service';

describe('ClubWechatTransactionService 服务商模式口径', () => {
  const configState: Record<string, string | boolean> = {
    'wechat.appId': 'wx_club_appid',
    'wechat.payNotifyUrl': 'https://api.example.com/club/callback',
    'wechat.partner.enabled': true,
    'wechat.partner.spMchId': 'SP0001',
    'wechat.partner.spAppId': 'wx_partner_appid',
    'wechat.partner.notifyUrl': 'https://api.example.com/club/callback',
  };
  const configService = { get: jest.fn((key: string) => configState[key]) };
  const storesService = { getWechatPayConfigForStore: jest.fn() };
  const httpService = { request: jest.fn() };

  const buildService = () =>
    new ClubWechatTransactionService(
      new ClubWechatPayIdentityService(
        configService as unknown as ConfigService,
        storesService as unknown as StoresWechatPayService,
      ),
      httpService as unknown as ClubWechatPayHttpService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    configState['wechat.partner.enabled'] = true;
    storesService.getWechatPayConfigForStore.mockResolvedValue({
      mchId: 'STORE_MCH',
      mchName: '示例门店',
      apiV3Key: 'plain-key',
      subMchId: 'SUB0001',
      bindStatus: 'pending',
      configuredAt: null,
    });
    httpService.request.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        trade_state: 'SUCCESS',
        transaction_id: '4200001',
        amount: { total: 1 },
      },
    });
  });

  it('查单走 partner 路径，并同时带上 sp_mchid 与 sub_mchid', async () => {
    const result = await buildService().queryByOutTradeNo({
      storeId: 1,
      orderNo: 'RC001',
    });

    expect(result).toEqual({ found: true, snapshot: expect.any(Object) });
    const call = httpService.request.mock.calls[0][0];
    expect(call.urlPath).toBe(
      '/v3/pay/partner/transactions/out-trade-no/RC001',
    );
    expect(call.mchId).toBe('SP0001');
    expect(call.credential).toBe('partner');
    expect(call.query).toBe('sp_mchid=SP0001&sub_mchid=SUB0001');
  });

  it('关单 body 带 sp_mchid 与 sub_mchid，用于指定关闭哪笔收款', async () => {
    httpService.request.mockResolvedValue({
      ok: true,
      status: 204,
      data: null,
    });

    await expect(
      buildService().closeOrder({ storeId: 1, orderNo: 'RC001' }),
    ).resolves.toBe('closed');

    const call = httpService.request.mock.calls[0][0];
    expect(call.urlPath).toBe(
      '/v3/pay/partner/transactions/out-trade-no/RC001/close',
    );
    expect(JSON.parse(call.body)).toEqual({
      sp_mchid: 'SP0001',
      sub_mchid: 'SUB0001',
    });
  });

  it('直连模式回落到原生路径与单一 mchid 口径（旧行为零变化）', async () => {
    configState['wechat.partner.enabled'] = false;

    await buildService().queryByOutTradeNo({ storeId: 1, orderNo: 'RC001' });

    const call = httpService.request.mock.calls[0][0];
    expect(call.urlPath).toBe('/v3/pay/transactions/out-trade-no/RC001');
    expect(call.mchId).toBe('STORE_MCH');
    expect(call.credential).toBe('store');
    expect(call.query).toBe('mchid=STORE_MCH');
  });

  it('门店未配置收款时查单按未配置处理，不回落到平台商户号', async () => {
    storesService.getWechatPayConfigForStore.mockResolvedValue({
      mchId: null,
      mchName: null,
      apiV3Key: null,
      subMchId: null,
      bindStatus: null,
      configuredAt: null,
    });

    await expect(
      buildService().queryByOutTradeNo({ storeId: 1, orderNo: 'RC001' }),
    ).resolves.toEqual({ found: false, code: 'STORE_MCH_NOT_CONFIGURED' });
    expect(httpService.request).not.toHaveBeenCalled();
  });
});
