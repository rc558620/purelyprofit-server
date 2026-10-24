import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../../redis/redis.service';
import { AuthSmsModeService } from './auth-sms-mode.service';
import { AUTH_SMS_MODE_KEY, AUTH_SMS_MODE_TTL_SECONDS } from './auth.constants';

/**
 * 短信通道模式裁决服务的回归用例。
 *
 * 覆盖：默认模式、运行期状态优先级、生产环境硬禁用、配置值归一化、
 * 手机号白名单、访问令牌校验、切换写入与缓存故障回落。
 */
describe('AuthSmsModeService', () => {
  let configMap: Record<string, unknown>;
  let redisGet: jest.Mock;
  let redisSet: jest.Mock;

  const buildService = async (): Promise<AuthSmsModeService> => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthSmsModeService,
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

    return moduleRef.get(AuthSmsModeService);
  };

  beforeEach(() => {
    configMap = {
      nodeEnv: 'development',
      'auth.smsMode': 'mock',
      'auth.smsModeSwitchEnabled': true,
      'auth.smsModeDevToken': 'dev-token',
      'auth.smsLiveAllowedPhones': [],
    };
    redisGet = jest.fn().mockResolvedValue(null);
    redisSet = jest.fn().mockResolvedValue(undefined);
  });

  it('未设置运行期状态时使用配置默认模式', async () => {
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('mock');
  });

  it('运行期状态优先于配置默认值', async () => {
    redisGet.mockResolvedValue('live');
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('live');
  });

  it('生产环境禁止切换，且不读取运行期状态', async () => {
    configMap.nodeEnv = 'production';
    configMap['auth.smsMode'] = 'live';
    configMap['auth.smsModeSwitchEnabled'] = true;
    redisGet.mockResolvedValue('mock');
    const service = await buildService();

    expect(service.isProduction()).toBe(true);
    expect(service.isSwitchEnabled()).toBe(false);
    // 生产环境即使 Redis 里残留了 mock，也必须按配置走 live
    await expect(service.getMode()).resolves.toBe('live');
    expect(redisGet).not.toHaveBeenCalled();
  });

  it('配置值忽略大小写与首尾空白', async () => {
    configMap['auth.smsMode'] = ' LIVE ';
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('live');
  });

  it('配置了白名单时名单外手机号降级为测试模式', async () => {
    configMap['auth.smsMode'] = 'live';
    configMap['auth.smsLiveAllowedPhones'] = ['13800138000'];
    const service = await buildService();

    await expect(service.shouldSendLive('13800138000')).resolves.toBe(true);
    await expect(service.shouldSendLive('13900139000')).resolves.toBe(false);
  });

  it('未配置白名单时不限制手机号', async () => {
    configMap['auth.smsMode'] = 'live';
    const service = await buildService();

    await expect(service.shouldSendLive('13900139000')).resolves.toBe(true);
  });

  it('令牌未配置或不一致时一律拒绝', async () => {
    const service = await buildService();
    expect(service.isDevTokenConfigured()).toBe(true);
    expect(service.isDevTokenValid('dev-token')).toBe(true);
    expect(service.isDevTokenValid('wrong-token')).toBe(false);
    expect(service.isDevTokenValid(undefined)).toBe(false);

    configMap['auth.smsModeDevToken'] = '';
    const noTokenService = await buildService();
    expect(noTokenService.isDevTokenConfigured()).toBe(false);
    expect(noTokenService.isDevTokenValid('dev-token')).toBe(false);
  });

  it('切换模式写入运行期状态并带 TTL', async () => {
    const service = await buildService();

    await expect(service.setMode('live')).resolves.toBe('live');
    expect(redisSet).toHaveBeenCalledWith(
      AUTH_SMS_MODE_KEY,
      'live',
      AUTH_SMS_MODE_TTL_SECONDS,
    );
  });

  it('Redis 读取失败时回落为配置默认模式', async () => {
    redisGet.mockRejectedValue(new Error('redis down'));
    const service = await buildService();

    await expect(service.getMode()).resolves.toBe('mock');
  });
});
