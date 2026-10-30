// 生产配置校验回归用例：服务商模式新增校验项不得误判/遗漏既有链路 b（短信充值）与 c（会员额度）
import type { ConfigService } from '@nestjs/config';
import { validateProductionConfiguration } from './production-config.utils';

type ConfigState = Record<string, string | boolean>;

const CLUB_CALLBACK_PATH = '/api/club/payments/wechat/callback';
const HTTPS_BASE = 'https://api.example.com';

function buildBaseState(): ConfigState {
  return {
    'database.url': 'postgresql://localhost:5432/purelyprofit',
    'redis.host': '127.0.0.1',
    'jwt.secret': 'a-strong-jwt-secret',
    'app.corsOrigin': 'https://admin.example.com',
    'wechat.appId': 'wx_real_miniprogram_appid',
    'wechat.appSecret': 'real_miniprogram_appsecret',
    'wechat.payNotifyUrl': `${HTTPS_BASE}${CLUB_CALLBACK_PATH}`,
    'wechat.mchSerialNo': 'PLATFORM_SERIAL_NO',
    'wechat.payMchId': '1900000001',
    'wechat.payApiV3Key': '0123456789abcdef0123456789abcdef',
    'wechat.privateKeyContent': '-----BEGIN PRIVATE KEY-----',
    'wechat.platformPublicKeyContent': '-----BEGIN PUBLIC KEY-----',
    WECHAT_PAY_KEY_ENCRYPTION_SECRET: 'x'.repeat(32),
    'profit.wechatPayNotifyUrl': `${HTTPS_BASE}/api/profit/payments/wechat/callback`,
    'sms.wechatPayNotifyUrl': `${HTTPS_BASE}/api/marketing/sms/wechat/callback`,
    'club.manualConfirmPaidEnabled': false,
    'club.paymentModeSwitchEnabled': false,
    'profit.manualPaidEnabled': false,
    'profit.paymentModeSwitchEnabled': false,
    'wechat.allowInsecureCallback': false,
    'app.portAutoTerminateEnabled': false,
    'app.portAutoShiftEnabled': false,
    'app.swaggerEnabled': false,
    'auth.adminLoginAlias': 'owner01',
    'auth.adminLoginPhone': '13800000000',
  };
}

function buildPartnerState(): ConfigState {
  return {
    'wechat.partner.enabled': true,
    'wechat.partner.spMchId': '1900000100',
    'wechat.partner.apiV3Key': 'fedcba9876543210fedcba9876543210',
    'wechat.partner.serialNo': 'PARTNER_SERIAL_NO',
    'wechat.partner.privateKeyContent': '-----BEGIN PRIVATE KEY-----',
    'wechat.partner.platformPublicKeyContent': '-----BEGIN PUBLIC KEY-----',
    'wechat.partner.notifyUrl': `${HTTPS_BASE}${CLUB_CALLBACK_PATH}`,
  };
}

function buildConfigService(state: ConfigState): ConfigService {
  return {
    get: (key: string) => state[key],
  } as unknown as ConfigService;
}

function collectErrors(state: ConfigState): string[] {
  try {
    validateProductionConfiguration(buildConfigService(state));
    return [];
  } catch (error) {
    return String((error as Error).message).split('\n');
  }
}

describe('production-config 服务商模式校验', () => {
  it('基线配置齐全时不报错（既有 b/c 链路校验仍然通过）', () => {
    expect(collectErrors(buildBaseState())).toEqual([]);
  });

  it('服务商模式关闭时，partner 变量全部缺失也不报错，避免误判现有部署', () => {
    expect(collectErrors(buildBaseState())).toEqual([]);
  });

  it('服务商模式开启且配置齐全时不报错', () => {
    const state = { ...buildBaseState(), ...buildPartnerState() };

    expect(collectErrors(state)).toEqual([]);
  });

  it('服务商模式缺少 spMchId 时报错', () => {
    const state = { ...buildBaseState(), ...buildPartnerState() };
    state['wechat.partner.spMchId'] = '';

    expect(collectErrors(state).join('\n')).toContain(
      'wechat.partner.spMchId 未配置',
    );
  });

  it('服务商模式缺少 apiV3Key 时报错（子商户没有自己的密钥）', () => {
    const state = { ...buildBaseState(), ...buildPartnerState() };
    state['wechat.partner.apiV3Key'] = '';

    expect(collectErrors(state).join('\n')).toContain(
      'wechat.partner.apiV3Key 未配置',
    );
  });

  it('spMchId 与 payMchId 相同且未豁免时按资金归属红线拦截', () => {
    const state = { ...buildBaseState(), ...buildPartnerState() };
    state['wechat.partner.spMchId'] = '1900000001';

    expect(collectErrors(state).join('\n')).toContain(
      'wechat.partner.spMchId 与 wechat.payMchId 相同',
    );
  });

  it('已豁免但缺少原因留档时报错', () => {
    const state = { ...buildBaseState(), ...buildPartnerState() };
    state['wechat.partner.spMchId'] = '1900000001';
    state['wechat.partner.allowSharedPlatformMchId'] = true;
    state['wechat.partner.sharedMchIdReason'] = '';

    expect(collectErrors(state).join('\n')).toContain(
      'wechat.partner.sharedMchIdReason',
    );
  });

  it('豁免并填写原因后不再拦截', () => {
    const state = { ...buildBaseState(), ...buildPartnerState() };
    state['wechat.partner.spMchId'] = '1900000001';
    state['wechat.partner.allowSharedPlatformMchId'] = true;
    state['wechat.partner.sharedMchIdReason'] = '该商户号确为服务商商户号';

    expect(collectErrors(state)).toEqual([]);
  });

  it('回调地址未指向 C 端订单路由时报错，防止与其它链路混用', () => {
    const state = { ...buildBaseState(), ...buildPartnerState() };
    state['wechat.partner.notifyUrl'] =
      `${HTTPS_BASE}/api/marketing/sms/wechat/callback`;

    expect(collectErrors(state).join('\n')).toContain(
      '必须以 /api/club/payments/wechat/callback 结尾',
    );
  });

  it('回调地址非 HTTPS 时报错', () => {
    const state = { ...buildBaseState(), ...buildPartnerState() };
    state['wechat.partner.notifyUrl'] =
      `http://api.example.com${CLUB_CALLBACK_PATH}`;

    expect(collectErrors(state).join('\n')).toContain(
      'wechat.partner.notifyUrl 必须是可访问的 HTTPS 正式地址',
    );
  });
});
