import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../../redis/redis.service';
import {
  CLUB_PAYMENT_MODE_KEY,
  CLUB_PAYMENT_MODE_TTL_SECONDS,
} from './club-payment-mode.constants';
import { ClubPaymentModeService } from './club-payment-mode.service';

/**
 * 支付模式裁决服务的回归用例。
 *
 * 这是资金安全边界的核心：覆盖默认模式推导、运行期状态优先级、
 * 生产环境硬禁用、TTL 到期安全侧回落、令牌校验与缓存故障回落。
 */
describe('ClubPaymentModeService', () => {
  let configMap: Record<string, unknown>;
  let redisGet: jest.Mock;
  let redisSet: jest.Mock;

  const buildService = async (): Promise<ClubPaymentModeService> => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ClubPaymentModeService,
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

    return moduleRef.get(ClubPaymentModeService);
  };

  beforeEach(() => {
    configMap = {
      nodeEnv: 'development',
      'club.manualConfirmPaidEnabled': true,
      'club.paymentModeSwitchEnabled': true,
      'club.paymentModeDevToken': 'pay-dev-token',
    };
    redisGet = jest.fn().mockResolvedValue(null);
    redisSet = jest.fn().mockResolvedValue(undefined);
  });

  it('未设置运行期状态时按安全侧落为 test', async () => {
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('test');
  });

  it('运行期状态优先于配置默认值', async () => {
    redisGet.mockResolvedValue('live');
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('live');
    await expect(service.isManualConfirmPaidAllowed()).resolves.toBe(false);
  });

  it('关闭配置开关时配置默认模式为 live 且不可手动确认', async () => {
    configMap['club.manualConfirmPaidEnabled'] = false;
    configMap['club.paymentModeSwitchEnabled'] = false;
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('live');
    await expect(service.isManualConfirmPaidAllowed()).resolves.toBe(false);
  });

  it('生产环境强制 live 且不读取运行期状态', async () => {
    configMap.nodeEnv = 'production';
    configMap['club.manualConfirmPaidEnabled'] = false;
    redisGet.mockResolvedValue('test');
    const service = await buildService();

    expect(service.isProduction()).toBe(true);
    expect(service.isSwitchEnabled()).toBe(false);
    await expect(service.getMode()).resolves.toBe('live');
    await expect(service.isManualConfirmPaidAllowed()).resolves.toBe(false);
    expect(redisGet).not.toHaveBeenCalled();
  });

  it('测试模式下允许手动确认支付', async () => {
    redisGet.mockResolvedValue('test');
    const service = await buildService();

    await expect(service.isManualConfirmPaidAllowed()).resolves.toBe(true);
  });

  it('配置关闭手动确认时，即使运行期是 test 也不放行', async () => {
    configMap['club.manualConfirmPaidEnabled'] = false;
    redisGet.mockResolvedValue('test');
    const service = await buildService();

    await expect(service.isManualConfirmPaidAllowed()).resolves.toBe(false);
  });

  it('运行期状态忽略大小写与首尾空白', async () => {
    redisGet.mockResolvedValue(' LIVE ');
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('live');
  });

  it('令牌未配置或不一致时一律拒绝', async () => {
    const service = await buildService();
    expect(service.isDevTokenConfigured()).toBe(true);
    expect(service.isDevTokenValid('pay-dev-token')).toBe(true);
    expect(service.isDevTokenValid('wrong-token')).toBe(false);
    expect(service.isDevTokenValid(undefined)).toBe(false);

    configMap['club.paymentModeDevToken'] = '';
    const noTokenService = await buildService();
    expect(noTokenService.isDevTokenConfigured()).toBe(false);
    expect(noTokenService.isDevTokenValid('pay-dev-token')).toBe(false);
  });

  it('切换模式写入运行期状态并带 TTL', async () => {
    const service = await buildService();

    await expect(service.setMode('live')).resolves.toBe('live');
    expect(redisSet).toHaveBeenCalledWith(
      CLUB_PAYMENT_MODE_KEY,
      'live',
      CLUB_PAYMENT_MODE_TTL_SECONDS,
    );
  });

  it('Redis 读取失败时按安全侧回落为 test', async () => {
    redisGet.mockRejectedValue(new Error('redis down'));
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('test');
  });
});
