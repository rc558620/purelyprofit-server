import { SmsTencentProvider } from './sms-tencent.provider';

const TENCENT_SMS_MAX_PHONE_COUNT = 200;

/** 构造带 SendSms 的假客户端，捕获每次请求的号码集合 */
function makeClient(
  respond: (request: { PhoneNumberSet: string[] }) => {
    SendStatusSet?: Array<{
      Code?: string;
      Message?: string;
      PhoneNumber?: string;
    }>;
  },
) {
  const calls: { PhoneNumberSet: string[] }[] = [];
  const SendSms = jest.fn((request: { PhoneNumberSet: string[] }) => {
    calls.push(request);
    return Promise.resolve(respond(request));
  });
  return { calls, SendSms };
}

function attachClient(provider: SmsTencentProvider, client: unknown): void {
  // provider 内部持有 client 私有字段，测试通过反射注入假客户端
  Object.defineProperty(provider, 'client', {
    value: client,
    writable: true,
  });
  Object.defineProperty(provider, 'marketingTemplateId', {
    value: '1234567',
    writable: true,
  });
  Object.defineProperty(provider, 'signName', {
    value: '纯利宝',
    writable: true,
  });
}

const mobileOf = (index: number): string =>
  `138${String(index).padStart(8, '0')}`;

describe('SmsTencentProvider', () => {
  const config = {
    get: jest.fn(() => 'dummy'),
  } as never;

  it('号码数超过 200 时按腾讯云硬上限切片（250 → 200 + 50）', async () => {
    const { calls, SendSms } = makeClient((request) => ({
      SendStatusSet: request.PhoneNumberSet.map((phone) => ({
        Code: 'Ok',
        PhoneNumber: phone,
      })),
    }));

    const provider = new SmsTencentProvider(config);
    attachClient(provider, { SendSms });

    const mobiles = Array.from({ length: 250 }, (_u, i) => mobileOf(i));
    const results = await provider.sendMarketingBatch(mobiles, '群发内容');

    expect(SendSms).toHaveBeenCalledTimes(2);
    expect(calls[0].PhoneNumberSet).toHaveLength(200);
    expect(calls[1].PhoneNumberSet).toHaveLength(50);
    expect(results).toHaveLength(250);
    expect(results.every((item) => item.ok)).toBe(true);
  });

  it('号码统一转成 E.164（+8613xxxxxxxx）', async () => {
    const { calls, SendSms } = makeClient((request) => ({
      SendStatusSet: request.PhoneNumberSet.map((phone) => ({
        Code: 'Ok',
        PhoneNumber: phone,
      })),
    }));

    const provider = new SmsTencentProvider(config);
    attachClient(provider, { SendSms });

    await provider.sendMarketingBatch([mobileOf(0)], '群发内容');

    expect(calls[0].PhoneNumberSet).toEqual([`+86${mobileOf(0)}`]);
  });

  it('逐条解析 SendStatusSet：部分号码失败不影响其它号码', async () => {
    const { SendSms } = makeClient(() => ({
      SendStatusSet: [
        { Code: 'Ok', PhoneNumber: `+86${mobileOf(0)}` },
        {
          Code: 'LimitExceeded.PhoneNumberCountLimit',
          Message: '号码数量超限',
          PhoneNumber: `+86${mobileOf(1)}`,
        },
      ],
    }));

    const provider = new SmsTencentProvider(config);
    attachClient(provider, { SendSms });

    const results = await provider.sendMarketingBatch(
      [mobileOf(0), mobileOf(1)],
      '群发内容',
    );

    expect(results[0]).toMatchObject({ phone: mobileOf(0), ok: true });
    expect(results[1]).toMatchObject({
      phone: mobileOf(1),
      ok: false,
      code: 'LimitExceeded.PhoneNumberCountLimit',
    });
  });

  it('整批请求异常时该批全部标记 failed，不抛异常中断群发', async () => {
    const { SendSms } = makeClient(() => {
      throw new Error('网络超时');
    });

    const provider = new SmsTencentProvider(config);
    attachClient(provider, { SendSms });

    const results = await provider.sendMarketingBatch(
      [mobileOf(0), mobileOf(1)],
      '群发内容',
    );

    expect(results).toHaveLength(2);
    expect(results.every((item) => !item.ok)).toBe(true);
    expect(results[0].code).toBe('REQUEST_FAILED');
  });

  it('空号码列表直接返回空结果，不调用通道', async () => {
    const { SendSms } = makeClient(() => ({}));
    const provider = new SmsTencentProvider(config);
    attachClient(provider, { SendSms });

    await expect(provider.sendMarketingBatch([], 'x')).resolves.toEqual([]);
    expect(SendSms).not.toHaveBeenCalled();
  });

  it('切片边界：正好 200 个号码只发一批', async () => {
    const { SendSms } = makeClient((request) => ({
      SendStatusSet: request.PhoneNumberSet.map((phone) => ({
        Code: 'Ok',
        PhoneNumber: phone,
      })),
    }));
    const provider = new SmsTencentProvider(config);
    attachClient(provider, { SendSms });

    await provider.sendMarketingBatch(
      Array.from({ length: TENCENT_SMS_MAX_PHONE_COUNT }, (_u, i) =>
        mobileOf(i),
      ),
      'x',
    );

    expect(SendSms).toHaveBeenCalledTimes(1);
  });
});
