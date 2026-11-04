import { InternalServerErrorException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { WECHAT_PAY_DEV_PLACEHOLDER_SIGNATURE } from './wechat-pay.constants';
import {
  buildWechatPayAuthorizationHeader,
  buildWechatPaySignMessage,
  WechatPaySignTransport,
} from './wechat-pay-sign-transport';

// 私钥来自磁盘文件：读取时序直接决定「并发请求拿到密钥还是拿到 null」，必须可控
jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));

const readFileMock = readFile as jest.MockedFunction<typeof readFile>;

const originalFetch = global.fetch;

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit]>;

/** 构造一个最小可用的 Response 替身，只实现传输层会读的字段 */
const makeResponse = (status: number, body?: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      body === undefined
        ? Promise.reject(new SyntaxError('no body'))
        : Promise.resolve(body),
  }) as unknown as Response;

describe('微信支付共享传输层', () => {
  const configState: Record<string, string> = {};
  const configService = {
    get: jest.fn((key: string) => configState[key]),
  };
  const logger = { warn: jest.fn(), error: jest.fn() };
  const fetchMock = jest.fn() as FetchMock;

  const buildTransport = () =>
    new WechatPaySignTransport({
      configService: configService as unknown as ConfigService,
      logger: logger as unknown as Logger,
      defaultScope: 'platform',
      resolveCredential: () => ({
        serialNoKey: 'wechat.mchSerialNo',
        privateKeyPathKey: 'wechat.privateKeyPath',
        privateKeyContentKey: 'wechat.privateKeyContent',
        failFastWhenMissingKeyInProduction: false,
        privateKeyPathHint: 'WECHAT_PRIVATE_KEY_PATH',
      }),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    readFileMock.mockReset();
    configState['nodeEnv'] = 'development';
    configState['wechat.mchSerialNo'] = 'SERIAL001';
    configState['wechat.privateKeyPath'] = '';
    configState['wechat.privateKeyContent'] = '';
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('GET 签名串末尾是两个换行（空 body 占一位）', () => {
    const message = buildWechatPaySignMessage({
      method: 'GET',
      canonicalUrl: '/v3/pay/transactions/out-trade-no/PM1',
      timestamp: '1700000000',
      nonce: 'abc123',
      body: '',
    });

    expect(message).toBe(
      'GET\n/v3/pay/transactions/out-trade-no/PM1\n1700000000\nabc123\n\n',
    );
  });

  it('鉴权头按微信要求的字段顺序拼接', () => {
    const header = buildWechatPayAuthorizationHeader({
      mchId: '1900000001',
      nonce: 'abc123',
      timestamp: '1700000000',
      signature: 'SIG',
      serialNo: 'SERIAL001',
    });

    expect(header).toBe(
      'WECHATPAY2-SHA256-RSA2048 mchid="1900000001",nonce_str="abc123",' +
        'signature="SIG",timestamp="1700000000",serial_no="SERIAL001"',
    );
  });

  it('2xx 返回 ok:true 并解析响应体', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(200, { prepay_id: 'wx_prepay_001' }),
    );

    const result = await buildTransport().request<{ prepay_id: string }>({
      method: 'POST',
      requestUrlPath: '/v3/pay/transactions/native',
      mchId: '1900000001',
      body: '{}',
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { prepay_id: 'wx_prepay_001' },
    });
    // 私钥未配置时走开发态占位签名，但请求本身必须照常发出
    const headers = fetchMock.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toContain(
      WECHAT_PAY_DEV_PLACEHOLDER_SIGNATURE,
    );
  });

  it('关单返回 204 时按 null 处理，不去 parse 空响应体', async () => {
    fetchMock.mockResolvedValue(makeResponse(204));

    const result = await buildTransport().request<null>({
      method: 'POST',
      requestUrlPath: '/v3/pay/transactions/out-trade-no/PM1/close',
      mchId: '1900000001',
      body: '{}',
    });

    expect(result).toEqual({ ok: true, status: 204, data: null });
  });

  it('4xx 不抛异常，带回微信错误码交给调用方判断语义', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(400, { code: 'ORDERPAID', message: '订单已支付' }),
    );

    const result = await buildTransport().request<unknown>({
      method: 'POST',
      requestUrlPath: '/v3/pay/transactions/out-trade-no/PM1/close',
      mchId: '1900000001',
      body: '{}',
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      code: 'ORDERPAID',
      message: '订单已支付',
    });
  });

  it('错误响应体不是 JSON 时降级为空 code/message', async () => {
    fetchMock.mockResolvedValue(makeResponse(502));

    const result = await buildTransport().request<unknown>({
      method: 'GET',
      requestUrlPath: '/v3/pay/transactions/id/4200001',
      mchId: '1900000001',
    });

    expect(result).toEqual({
      ok: false,
      status: 502,
      code: null,
      message: '',
    });
  });

  it('网络层不可达抛 500，并提示稍后重试', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await expect(
      buildTransport().request<unknown>({
        method: 'GET',
        requestUrlPath: '/v3/pay/transactions/id/4200001',
        mchId: '1900000001',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('私钥读取期间的并发请求复用同一次加载，不会拿到「无密钥」结论', async () => {
    configState['wechat.privateKeyPath'] = '/etc/wechat/apiclient_key.pem';
    let releaseRead: (pem: string) => void = () => {};
    readFileMock.mockReturnValue(
      new Promise<string>((resolve) => {
        releaseRead = resolve;
      }),
    );

    const transport = buildTransport();
    // 第一次调用把读文件挂在 await 上；此时第二个请求到达，必须复用同一次加载
    const first = transport.loadPrivateKeyPem();
    const second = transport.loadPrivateKeyPem();
    releaseRead('-----BEGIN PRIVATE KEY-----PEM');

    await expect(first).resolves.toBe('-----BEGIN PRIVATE KEY-----PEM');
    await expect(second).resolves.toBe('-----BEGIN PRIVATE KEY-----PEM');
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });

  it('私钥读取失败后不缓存「无密钥」结论，下一次请求会重新尝试', async () => {
    // 生产环境：文件读取失败必须每次都报错，不能退化成占位签名
    configState['nodeEnv'] = 'production';
    configState['wechat.privateKeyPath'] = '/etc/wechat/missing_key.pem';
    readFileMock.mockRejectedValue(new Error('ENOENT: no such file'));

    const transport = buildTransport();

    await expect(transport.loadPrivateKeyPem()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(transport.loadPrivateKeyPem()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });

  it('缺少证书序列号配置时直接失败，不发出注定被拒的请求', async () => {
    configState['wechat.mchSerialNo'] = '';

    await expect(
      buildTransport().request<unknown>({
        method: 'GET',
        requestUrlPath: '/v3/pay/transactions/id/4200001',
        mchId: '1900000001',
      }),
    ).rejects.toThrow('环境变量 wechat.mchSerialNo 未配置，无法发起微信支付');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
