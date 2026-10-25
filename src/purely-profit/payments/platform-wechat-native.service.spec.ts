import { generateKeyPairSync } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import { InternalServerErrorException } from '@nestjs/common';
import { PlatformWechatNativeService } from './platform-wechat-native.service';

// node:fs/promises 的导出是只读属性，jest.spyOn 会报「Cannot redefine property」，
// 只能用工厂 mock 整个模块，再由用例控制 readFile 的返回值与调用次数
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
}));

const PLATFORM_MCH_ID = '1900000001';

function makeConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    'wechat.payMchId': PLATFORM_MCH_ID,
    'wechat.appId': 'wxappid',
    'wechat.mchSerialNo': 'SERIAL001',
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) };
}

const makeService = (overrides: Record<string, string> = {}) =>
  new PlatformWechatNativeService(makeConfig(overrides) as never);

interface FetchCall {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** 捕获 fetch 调用；status 用来模拟微信的非 2xx 业务错误 */
function mockFetch(
  responseBody: unknown,
  options: { status?: number } = {},
): FetchCall[] {
  const calls: FetchCall[] = [];
  const status = options.status ?? 200;

  global.fetch = jest.fn(
    (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, body: init.body, headers: init.headers });
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(responseBody),
      } as Response);
    },
  ) as unknown as typeof fetch;

  return calls;
}

/**
 * 关单是「本地置 closed 之前的唯一保险」：
 * 微信二维码 2 小时有效，关单判断错一次就会变成「用户扫码付成功、系统已放弃」。
 */
describe('PlatformWechatNativeService 关单', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('关单成功（204 无响应体）返回 closed', async () => {
    const calls = mockFetch({}, { status: 204 });

    await expect(makeService().closeNativeOrder('PM1')).resolves.toBe('closed');

    expect(calls[0].url).toBe(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/PM1/close',
    );
    expect(JSON.parse(calls[0].body)).toEqual({ mchid: PLATFORM_MCH_ID });
  });

  it('微信报 ORDERPAID 时返回 paid，调用方据此保持 pending', async () => {
    mockFetch({ code: 'ORDERPAID', message: '订单已支付' }, { status: 400 });

    await expect(makeService().closeNativeOrder('PM1')).resolves.toBe('paid');
  });

  it('微信报 ORDER_NOT_EXIST 时按「不可支付」返回 closed', async () => {
    mockFetch({ code: 'ORDER_NOT_EXIST', message: '订单不存在' }, { status: 404 });

    await expect(makeService().closeNativeOrder('PM1')).resolves.toBe('closed');
  });

  it('其他业务错误直接抛出，由调用方按「结果未知」处理', async () => {
    mockFetch({ code: 'SIGN_ERROR', message: '签名错误' }, { status: 401 });

    await expect(makeService().closeNativeOrder('PM1')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('网络异常统一包装为「服务暂时不可用」', async () => {
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('ECONNRESET')),
    ) as unknown as typeof fetch;

    await expect(makeService().closeNativeOrder('PM1')).rejects.toThrow(
      /暂时不可用/,
    );
  });

  it('订单号含保留字符时，请求 URL 走编码（签名用原始 path）', async () => {
    const calls = mockFetch({}, { status: 204 });

    await makeService().closeNativeOrder('PM/1');

    expect(calls[0].url).toContain('/out-trade-no/PM%2F1/close');
  });

  it('透传 bizType 到日志上下文，不影响请求体', async () => {
    const calls = mockFetch({}, { status: 204 });

    await makeService().closeNativeOrder('PM1', 'membership');

    // bizType 只用于日志定位链路，绝不能混进微信请求体
    expect(JSON.parse(calls[0].body)).toEqual({ mchid: PLATFORM_MCH_ID });
  });
});

describe('PlatformWechatNativeService 私钥加载', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('并发下单共用同一次私钥读取，不做 N 次 readFile', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = String(privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const readFileMock = fsPromises.readFile as unknown as jest.Mock;
    readFileMock.mockClear();
    readFileMock.mockResolvedValue(pem);
    mockFetch({ code_url: 'weixin://wxpay/x' });

    const service = makeService({ 'wechat.privateKeyPath': '/tmp/key.pem' });
    const params = {
      orderNo: 'PM1',
      amountFen: 1000,
      description: '并发下单',
      notifyUrl: 'https://api.example.com/api/profit/payments/wechat/callback',
    };

    await Promise.all([
      service.createNativeOrder(params),
      service.createNativeOrder(params),
      service.createNativeOrder(params),
    ]);

    // 缓存失效瞬间的并发请求必须合并成一次 IO
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });

  it('私钥未配置时降级为占位签名，不把下单打成 500', async () => {
    const calls = mockFetch({ code_url: 'weixin://wxpay/x' });

    await makeService().createNativeOrder({
      orderNo: 'PM1',
      amountFen: 1000,
      description: '开发态下单',
      notifyUrl: 'https://api.example.com/api/profit/payments/wechat/callback',
    });

    expect(calls[0].headers.Authorization).toContain('DEV_MODE_NO_RSA_KEY');
  });
});
