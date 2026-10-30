import type { ConfigService } from '@nestjs/config';
import type { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';
import { ClubWechatPayIdentityService } from './club-wechat-pay-identity.service';

type StoreConfig = {
  mchId: string | null;
  mchName: string | null;
  apiV3Key: string | null;
  subMchId: string | null;
  bindStatus: string | null;
  configuredAt: Date | null;
};

describe('ClubWechatPayIdentityService', () => {
  const configState: Record<string, string | boolean> = {
    'wechat.appId': 'wx_club_appid',
    'wechat.payNotifyUrl':
      'https://api.example.com/api/club/payments/wechat/callback',
    'wechat.partner.enabled': false,
    'wechat.partner.spMchId': '1900000001',
    'wechat.partner.spAppId': 'wx_club_appid',
    'wechat.partner.notifyUrl':
      'https://api.example.com/api/club/payments/wechat/callback',
  };

  const configService = {
    get: jest.fn((key: string) => configState[key]),
  };
  const storesService = {
    getWechatPayConfigForStore: jest.fn(),
  };

  const buildService = () =>
    new ClubWechatPayIdentityService(
      configService as unknown as ConfigService,
      storesService as unknown as StoresWechatPayService,
    );

  const storeConfig: StoreConfig = {
    mchId: 'SUB_STORE_MCH',
    mchName: '示例门店',
    apiV3Key: 'plain-key',
    subMchId: 'SUB0001',
    bindStatus: 'pending',
    configuredAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configState['wechat.partner.enabled'] = false;
    storesService.getWechatPayConfigForStore.mockResolvedValue(storeConfig);
  });

  it('直连模式：门店商户号同时作为签名主体与收款方', async () => {
    const target = await buildService().resolveTarget(1);

    expect(target).toEqual({
      mode: 'store',
      signMchId: 'SUB_STORE_MCH',
      settleMchId: 'SUB_STORE_MCH',
      appId: 'wx_club_appid',
      notifyUrl: 'https://api.example.com/api/club/payments/wechat/callback',
    });
  });

  it('服务商模式：签名主体是服务商商户号，资金去向是子商户号', async () => {
    configState['wechat.partner.enabled'] = true;

    const target = await buildService().resolveTarget(1);

    expect(target).toEqual({
      mode: 'partner',
      signMchId: '1900000001',
      settleMchId: 'SUB0001',
      appId: 'wx_club_appid',
      notifyUrl: 'https://api.example.com/api/club/payments/wechat/callback',
    });
  });

  it('服务商模式下子商户号为空时回落到旧的门店商户号（灰度迁移窗口）', async () => {
    configState['wechat.partner.enabled'] = true;
    storesService.getWechatPayConfigForStore.mockResolvedValue({
      ...storeConfig,
      subMchId: null,
    });

    const target = await buildService().resolveTarget(1);

    expect(target?.settleMchId).toBe('SUB_STORE_MCH');
  });

  it('门店完全没配收款时返回 null，绝不能回落到平台商户号', async () => {
    storesService.getWechatPayConfigForStore.mockResolvedValue({
      ...storeConfig,
      mchId: null,
      subMchId: null,
    });

    expect(await buildService().resolveTarget(1)).toBeNull();
  });

  it('服务商模式缺少服务商商户号时抛错，避免用错主体签名', async () => {
    configState['wechat.partner.enabled'] = true;
    const spMchId = configState['wechat.partner.spMchId'];
    delete configState['wechat.partner.spMchId'];

    await expect(buildService().resolveTarget(1)).rejects.toThrow(
      '服务商商户号未配置',
    );

    configState['wechat.partner.spMchId'] = spMchId;
  });
});
