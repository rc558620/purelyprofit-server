import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../../redis/redis.service';
import {
  PROFIT_PAYMENT_MODE_KEY,
  PROFIT_PAYMENT_MODE_TTL_SECONDS,
} from './profit-payment-mode.constants';
import { ProfitPaymentModeService } from './profit-payment-mode.service';

/**
 * 商家端支付模式裁决服务的回归用例。
 *
 * 覆盖：默认模式推导、运行期优先级、生产硬禁用、令牌校验、
 * 切换写入与缓存故障回落。这是「是否真实扣款」的判定入口，属于资金安全边界。
 */
describe('ProfitPaymentModeService', () => {
  let configMap: Record<string, unknown>;
  let redisGet: jest.Mock;
  let redisSet: jest.Mock;

  const buildService = async (): Promise<ProfitPaymentModeService> => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ProfitPaymentModeService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configMap[key] },
        },
        {
          provide: RedisService,
          useValue: { get: redisGet, set: redisSet },
        },
      ],
    }).compile();

    return moduleRef.get(ProfitPaymentModeService);
  };

  beforeEach(() => {
    configMap = {
      nodeEnv: 'development',
      'profit.manualPaidEnabled': true,
      'profit.paymentModeSwitchEnabled': true,
      'profit.paymentModeDevToken': 'profit-dev-token',
    };
    redisGet = jest.fn().mockResolvedValue(null);
    redisSet = jest.fn().mockResolvedValue(undefined);
  });

  it('未设置运行期状态时按配置默认模式落为 test', async () => {
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('test');
    await expect(service.isSkipPaymentAllowed()).resolves.toBe(true);
  });

  it('运行期状态优先于配置默认值', async () => {
    redisGet.mockResolvedValue('live');
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('live');
    await expect(service.isSkipPaymentAllowed()).resolves.toBe(false);
  });

  it('生产环境强制 live 且不读取运行期状态', async () => {
    configMap.nodeEnv = 'production';
    configMap['profit.manualPaidEnabled'] = false;
    redisGet.mockResolvedValue('test');
    const service = await buildService();

    expect(service.isProduction()).toBe(true);
    expect(service.isSwitchEnabled()).toBe(false);
    await expect(service.getMode()).resolves.toBe('live');
    await expect(service.isSkipPaymentAllowed()).resolves.toBe(false);
    expect(redisGet).not.toHaveBeenCalled();
  });

  it('配置默认模式为 live 时，即使运行期切到 test 也不放行跳过扣款', async () => {
    configMap['profit.manualPaidEnabled'] = false;
    redisGet.mockResolvedValue('test');
    const service = await buildService();

    await expect(service.isSkipPaymentAllowed()).resolves.toBe(false);
  });

  it('运行期状态忽略大小写与首尾空白', async () => {
    redisGet.mockResolvedValue(' TEST ');
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('test');
  });

  it('未知的运行期值按「会真实扣款」收口为 live', async () => {
    redisGet.mockResolvedValue('unknown');
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('live');
  });

  it('令牌未配置或不一致时一律拒绝', async () => {
    const service = await buildService();
    expect(service.isDevTokenConfigured()).toBe(true);
    expect(service.isDevTokenValid('profit-dev-token')).toBe(true);
    expect(service.isDevTokenValid('wrong-token')).toBe(false);
    expect(service.isDevTokenValid(undefined)).toBe(false);

    configMap['profit.paymentModeDevToken'] = '';
    const noTokenService = await buildService();
    expect(noTokenService.isDevTokenConfigured()).toBe(false);
    expect(noTokenService.isDevTokenValid('profit-dev-token')).toBe(false);
  });

  it('切换模式写入运行期状态并带 TTL', async () => {
    const service = await buildService();

    await expect(service.setMode('live')).resolves.toBe('live');
    expect(redisSet).toHaveBeenCalledWith(
      PROFIT_PAYMENT_MODE_KEY,
      'live',
      PROFIT_PAYMENT_MODE_TTL_SECONDS,
    );
  });

  it('Redis 读取失败时回落为配置默认模式', async () => {
    redisGet.mockRejectedValue(new Error('redis down'));
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('test');
  });
});
