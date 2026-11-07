import { isWechatPayConfigured } from './wechat-pay-config-status';

describe('isWechatPayConfigured（设置页与营销概览共用的唯一口径）', () => {
  const verifiedPartner = {
    mchId: '1234567890',
    apiV3KeyEnc: '',
    subMchId: '1234567890',
    bindStatus: 'verified',
  };

  it('服务商模式：绑定校验通过才算已配置', () => {
    expect(isWechatPayConfigured(verifiedPartner, true)).toBe(true);
  });

  it.each(['pending', 'failed', null] as const)(
    '服务商模式：bindStatus=%s 时一律不算已配置',
    (bindStatus) => {
      expect(
        isWechatPayConfigured({ ...verifiedPartner, bindStatus }, true),
      ).toBe(false);
    },
  );

  it('服务商模式：保存过商户号但缺 subMchId 时不算已配置', () => {
    expect(
      isWechatPayConfigured({ ...verifiedPartner, subMchId: null }, true),
    ).toBe(false);
  });

  it('服务商模式：即使有旧直连密钥，绑定未通过仍不算已配置', () => {
    // 回归 B1：营销概览旧口径只看 mchId + configuredAt，会把它误判为「已配置」
    expect(
      isWechatPayConfigured(
        {
          ...verifiedPartner,
          apiV3KeyEnc: 'enc(key)',
          bindStatus: 'pending',
        },
        true,
      ),
    ).toBe(false);
  });

  it('直连模式：商户号 + APIv3 密钥齐全才算已配置，忽略绑定状态', () => {
    expect(
      isWechatPayConfigured(
        {
          mchId: '1234567890',
          apiV3KeyEnc: 'enc(key)',
          subMchId: null,
          bindStatus: 'pending',
        },
        false,
      ),
    ).toBe(true);
  });

  it('直连模式：缺密钥时不算已配置（回调无法解密）', () => {
    expect(
      isWechatPayConfigured(
        {
          mchId: '1234567890',
          apiV3KeyEnc: '',
          subMchId: null,
          bindStatus: 'verified',
        },
        false,
      ),
    ).toBe(false);
  });

  it('空配置在两种模式下都不算已配置', () => {
    const empty = {
      mchId: null,
      apiV3KeyEnc: null,
      subMchId: null,
      bindStatus: null,
    };
    expect(isWechatPayConfigured(empty, true)).toBe(false);
    expect(isWechatPayConfigured(empty, false)).toBe(false);
  });
});
