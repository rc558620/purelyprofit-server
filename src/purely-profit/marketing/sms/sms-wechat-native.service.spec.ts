import { InternalServerErrorException } from '@nestjs/common';
import { PlatformWechatNativeService } from '../../payments/platform-wechat-native.service';
import { PlatformWechatPayHttpService } from '../../payments/platform-wechat-pay-http.service';
import { SmsWechatNativeService } from './sms-wechat-native.service';

const PLATFORM_MCH_ID = '1900000001';

function makeConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    'wechat.payMchId': PLATFORM_MCH_ID,
    'wechat.appId': 'wxappid',
    'wechat.mchSerialNo': 'SERIAL001',
    'sms.wechatPayNotifyUrl':
      'https://api.example.com/api/marketing/sms/wechat/callback',
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) };
}

// 下单实现已上浮到 PlatformWechatNativeService，这里用真实实现做委托方，
// 保证「短信侧薄适配 + 平台侧真实下单」这条链路被端到端覆盖而不是只测桩
const makeService = (
  overrides: Record<string, string> = {},
): SmsWechatNativeService => {
  const config = makeConfig(overrides);
  return new SmsWechatNativeService(
    config as never,
    new PlatformWechatNativeService(
      config as never,
      new PlatformWechatPayHttpService(config as never),
    ),
  );
};

/** 捕获 fetch 调用 */
function mockFetch(responseBody: unknown, ok = true) {
  const calls: {
    url: string;
    body: string;
    headers: Record<string, string>;
  }[] = [];
  const fetchMock = jest.fn(
    (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, body: init.body, headers: init.headers });
      return Promise.resolve({
        ok,
        json: () => Promise.resolve(responseBody),
      } as Response);
    },
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return calls;
}

describe('SmsWechatNativeService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('下单成功返回 code_url', async () => {
    const calls = mockFetch({ code_url: 'weixin://wxpay/x' });

    const result = await makeService().createNativeOrder({
      orderNo: 'SM202610152030001234AB',
      amountFen: 1000,
      description: '短信钱包充值',
    });

    expect(result.codeUrl).toBe('weixin://wxpay/x');
    expect(calls[0].url).toBe(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/native',
    );
  });

  it('使用平台商户号下单，与门店收款配置无关', async () => {
    const calls = mockFetch({ code_url: 'weixin://wxpay/x' });

    await makeService().createNativeOrder({
      orderNo: 'SM1',
      amountFen: 1000,
      description: '短信钱包充值',
    });

    const body = JSON.parse(calls[0].body);
    expect(body.mchid).toBe(PLATFORM_MCH_ID);
    expect(body.out_trade_no).toBe('SM1');
    expect(body.amount).toEqual({ total: 1000, currency: 'CNY' });
    // 短信专用回调地址，不是 club 的通用地址
    expect(body.notify_url).toContain('/marketing/sms/wechat/callback');
  });

  it('平台商户号未配置时报「联系平台管理员」，不再误导商家去配门店收款', async () => {
    mockFetch({});

    await expect(
      makeService({ 'wechat.payMchId': '' }).createNativeOrder({
        orderNo: 'SM1',
        amountFen: 1000,
        description: '短信钱包充值',
      }),
    ).rejects.toThrow(/平台微信收款未配置|WECHAT_PAY_MCH_ID/);
  });

  it('短信回调地址未配置时拒绝下单（不回落到 club 回调）', async () => {
    mockFetch({});

    await expect(
      makeService({ 'sms.wechatPayNotifyUrl': '' }).createNativeOrder({
        orderNo: 'SM1',
        amountFen: 1000,
        description: '短信钱包充值',
      }),
    ).rejects.toThrow(/SMS_WECHAT_PAY_NOTIFY_URL/);
  });

  it('appId 未配置时拒绝下单', async () => {
    mockFetch({});

    await expect(
      makeService({ 'wechat.appId': '' }).createNativeOrder({
        orderNo: 'SM1',
        amountFen: 1000,
        description: '短信钱包充值',
      }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('微信返回业务错误时抛 5xx 并带上微信的错误信息', async () => {
    mockFetch({ code: 'INVALID_REQUEST', message: '参数错误' }, false);

    await expect(
      makeService().createNativeOrder({
        orderNo: 'SM1',
        amountFen: 1000,
        description: '短信钱包充值',
      }),
    ).rejects.toThrow(/参数错误/);
  });

  it('响应缺少 code_url 时拒绝（没有二维码等于没法支付）', async () => {
    mockFetch({});

    await expect(
      makeService().createNativeOrder({
        orderNo: 'SM1',
        amountFen: 1000,
        description: '短信钱包充值',
      }),
    ).rejects.toThrow(/code_url 为空/);
  });

  it('网络异常时统一包装为「服务暂时不可用」', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('ECONNRESET')),
    ) as unknown as typeof fetch;

    await expect(
      makeService().createNativeOrder({
        orderNo: 'SM1',
        amountFen: 1000,
        description: '短信钱包充值',
      }),
    ).rejects.toThrow(/暂时不可用/);
  });

  it('私钥未配置时降级为占位签名，不崩溃（微信会拒绝该请求）', async () => {
    const calls = mockFetch({ code_url: 'weixin://wxpay/x' });

    await makeService().createNativeOrder({
      orderNo: 'SM1',
      amountFen: 1000,
      description: '短信钱包充值',
    });

    expect(calls[0].headers.Authorization).toContain('DEV_MODE_NO_RSA_KEY');
  });

  it('关单委托给平台服务，短信侧不再自己实现一套关单', async () => {
    const calls = mockFetch({});

    await expect(makeService().closeNativeOrder('SM1')).resolves.toBe('closed');

    expect(calls[0].url).toContain('/v3/pay/transactions/out-trade-no/SM1');
  });
});
