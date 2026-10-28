import { createVerify, generateKeyPairSync, type KeyObject } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import { InternalServerErrorException } from '@nestjs/common';
import { PlatformWechatPayHttpService } from './platform-wechat-pay-http.service';
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

const makeService = (overrides: Record<string, string> = {}) => {
  const config = makeConfig(overrides);
  return new PlatformWechatNativeService(
    config as never,
    new PlatformWechatPayHttpService(config as never),
  );
};

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
    mockFetch(
      { code: 'ORDER_NOT_EXIST', message: '订单不存在' },
      { status: 404 },
    );

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

/** 从 Authorization 头里取出各字段，便于校验签名与时间戳 */
function parseAuthorization(header: string): {
  mchid: string;
  nonce: string;
  signature: string;
  timestamp: string;
  serial: string;
} {
  const read = (key: string): string => {
    const matched = new RegExp(`${key}="([^"]*)"`).exec(header);
    return matched?.[1] ?? '';
  };

  return {
    mchid: read('mchid'),
    nonce: read('nonce_str'),
    signature: read('signature'),
    timestamp: read('timestamp'),
    serial: read('serial_no'),
  };
}

/**
 * 查单是对账的事实来源。
 *
 * 这里重点验证 GET 的签名串：没有请求体时末尾必须是**两个** `\n`，
 * 照抄 POST 的拼法会签名失败，而且失败信息只有「签名错误」，很难定位。
 */
describe('PlatformWechatNativeService 查单', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** 生成一个已配置私钥的服务实例，并接管 fetch */
  const prepare = (
    responseBody: unknown,
    options: { status?: number } = {},
  ): FetchCall[] => {
    const readFileMock = fsPromises.readFile as unknown as jest.Mock;
    readFileMock.mockClear();
    readFileMock.mockResolvedValue(privateKeyPem);
    return mockFetch(responseBody, options);
  };

  const makeQueryService = (): PlatformWechatNativeService =>
    makeService({ 'wechat.privateKeyPath': '/tmp/key.pem' });

  it('查单成功时返回微信侧交易快照', async () => {
    prepare({
      trade_state: 'SUCCESS',
      transaction_id: '4200000000000000000000000000',
      success_time: '2026-10-28T10:59:00+08:00',
      amount: { total: 1 },
    });

    const result = await makeQueryService().queryNativeOrder('PM1');

    expect(result).toEqual({
      tradeState: 'SUCCESS',
      transactionId: '4200000000000000000000000000',
      amountFen: 1,
      paidAt: new Date('2026-10-28T02:59:00.000Z'),
    });
  });

  it('请求 URL 用编码单号，签名串用未编码单号 + mchid query', async () => {
    const calls = prepare({ trade_state: 'NOTPAY', amount: { total: 1 } });

    await makeQueryService().queryNativeOrder('PM/1', 'membership');

    // 请求：单号编码，商户号同样编码
    expect(calls[0].url).toBe(
      `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/PM%2F1?mchid=${PLATFORM_MCH_ID}`,
    );

    // 签名：未编码单号；GET 无请求体，末尾两个 \n
    const authorization = parseAuthorization(
      calls[0].headers.Authorization as string,
    );
    const expectedMessage =
      'GET\n' +
      `/v3/pay/transactions/out-trade-no/PM/1?mchid=${PLATFORM_MCH_ID}\n` +
      `${authorization.timestamp}\n` +
      `${authorization.nonce}\n` +
      '\n';

    const verify = createVerify('RSA-SHA256');
    verify.update(expectedMessage, 'utf8');
    expect(
      verify.verify(publicKey as KeyObject, authorization.signature, 'base64'),
    ).toBe(true);
  });

  it('查不到订单时返回 null，而不是当成未支付', async () => {
    prepare(
      { code: 'ORDER_NOT_EXIST', message: '订单不存在' },
      { status: 404 },
    );

    await expect(
      makeQueryService().queryNativeOrder('PM1'),
    ).resolves.toBeNull();
  });

  it('微信返回系统错误时抛错，由调用方保持 pending 等下轮', async () => {
    prepare({ code: 'SYSTEM_ERROR', message: '系统错误' }, { status: 500 });

    await expect(makeQueryService().queryNativeOrder('PM1')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('网络异常统一包装为「服务暂时不可用」', async () => {
    const readFileMock = fsPromises.readFile as unknown as jest.Mock;
    readFileMock.mockClear();
    readFileMock.mockResolvedValue(privateKeyPem);
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('ECONNRESET')),
    ) as unknown as typeof fetch;

    await expect(makeQueryService().queryNativeOrder('PM1')).rejects.toThrow(
      /暂时不可用/,
    );
  });
});
