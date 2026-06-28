import * as childProcess from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  bootstrap,
  filterSwaggerDocumentForEnvironment,
  createRequestIdGenerator,
} from './main';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    create: jest.fn(),
  },
}));

jest.mock('node:child_process', () => ({
  spawnSync: jest.fn(),
}));

describe('main bootstrap', () => {
  const createMock = NestFactory.create as jest.MockedFunction<
    typeof NestFactory.create
  >;

  const app = {
    useGlobalPipes: jest.fn(),
    setGlobalPrefix: jest.fn(),
    enableCors: jest.fn(),
    register: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    getHttpAdapter: jest.fn(() => ({
      getInstance: () => ({
        addHook: jest.fn(),
        addContentTypeParser: jest.fn(),
      }),
    })),
    listen: jest.fn().mockResolvedValue(undefined),
    enableShutdownHooks: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    app.useGlobalPipes.mockClear();
    app.setGlobalPrefix.mockClear();
    app.enableCors.mockClear();
    app.get.mockClear();
    app.listen.mockClear();
    createMock.mockResolvedValue(app as never);
    (childProcess.spawnSync as jest.Mock).mockReturnValue({
      stdout: '',
    } as never);
  });

  it('生产环境会校验关键配置', async () => {
    const bootstrapConfig = {
      get: jest.fn((key: string) => {
        const configMap: Record<string, string | number | boolean> = {
          nodeEnv: 'production',
          'app.logEnabled': false,
          'app.httpBodyLimitBytes': 1024,
          'app.httpKeepAliveTimeoutMs': 70000,
          'app.httpRequestTimeoutMs': 12000,
          'app.corsOrigin': '*',
          'app.portAutoTerminateEnabled': false,
          'app.portAutoShiftEnabled': false,
          'app.slowRequestLogEnabled': false,
          'app.slowRequestThresholdMs': 800,
          'app.swaggerEnabled': false,
          'database.url': 'postgresql://demo',
          'jwt.secret': 'secret',
          'club.manualConfirmPaidEnabled': false,
          'wechat.platformPublicKeyContent': '',
          'wechat.payNotifyUrl':
            'https://api.yourdomain.com/api/club/payments/wechat/callback',
          port: 3000,
        };
        return configMap[key];
      }),
    };
    const runtimeConfig = {
      get: bootstrapConfig.get,
    };

    jest
      .spyOn(ConfigService.prototype, 'get')
      .mockImplementation(bootstrapConfig.get);
    app.get.mockImplementation((token: unknown) => {
      if (token === ConfigService) {
        return runtimeConfig;
      }
      return undefined;
    });

    await expect(bootstrap()).rejects.toThrow('[bootstrap] 生产配置校验失败:');
    expect(app.listen).not.toHaveBeenCalled();
  });

  it('会把 Fastify 运行时参数传给适配器', async () => {
    const bootstrapConfig = {
      get: jest.fn((key: string) => {
        const configMap: Record<string, string | number | boolean> = {
          nodeEnv: 'production',
          'app.logEnabled': false,
          'app.httpBodyLimitBytes': 1024,
          'app.httpKeepAliveTimeoutMs': 70000,
          'app.httpRequestTimeoutMs': 12000,
          'app.corsOrigin': 'https://app.purelyprofit.com',
          'app.portAutoTerminateEnabled': false,
          'app.portAutoShiftEnabled': false,
          'app.slowRequestLogEnabled': false,
          'app.slowRequestThresholdMs': 800,
          'app.swaggerEnabled': false,
          'database.url': 'postgresql://demo',
          'jwt.secret': 'jwt-secret-demo',
          'redis.host': '127.0.0.1',
          'club.manualConfirmPaidEnabled': false,
          'wechat.appId': 'wx_prod_demo_app_id',
          'wechat.appSecret': 'prod-demo-app-secret',
          'wechat.mchSerialNo': 'prod-demo-mch-serial-no',
          'wechat.privateKeyContent':
            '-----BEGIN PRIVATE KEY-----demo-----END PRIVATE KEY-----',
          'wechat.platformPublicKeyContent':
            '-----BEGIN PUBLIC KEY-----demo-----END PUBLIC KEY-----',
          'wechat.payNotifyUrl':
            'https://api.purelyprofit.com/api/club/payments/wechat/callback',
          port: 3000,
        };
        return configMap[key];
      }),
    };
    const runtimeConfig = {
      get: bootstrapConfig.get,
    };

    jest
      .spyOn(ConfigService.prototype, 'get')
      .mockImplementation(bootstrapConfig.get);
    app.get.mockImplementation((token: unknown) => {
      if (token === ConfigService) {
        return runtimeConfig;
      }
      return undefined;
    });

    await bootstrap();

    expect(createMock).toHaveBeenCalledTimes(1);
    const adapterArg = createMock.mock.calls[0]?.[1] as unknown as {
      instance?: { initialConfig?: Record<string, unknown> };
    };
    // initialConfig 中持久化的参数
    expect(adapterArg.instance?.initialConfig).toMatchObject({
      bodyLimit: 1024,
      keepAliveTimeout: 70000,
      requestTimeout: 12000,
      connectionTimeout: 5_000,
      routerOptions: {
        ignoreTrailingSlash: true,
      },
    });
    // trustProxy 和 genReqId 被 Fastify 内部消费，不暴露在 initialConfig 中，
    // 通过检查 requestIdHeader=false 确认 genReqId 已注册（Fastify 在自定义 genReqId 时关闭默认 header 读取）
    expect(adapterArg.instance?.initialConfig?.requestIdHeader).toBe(false);
    expect(app.enableShutdownHooks).toHaveBeenCalled();
    expect(app.listen).toHaveBeenCalledWith(3000, '0.0.0.0');
  });

  it('createRequestIdGenerator 优先使用 X-Request-Id 头，否则生成 UUID', () => {
    const genReqId = createRequestIdGenerator();

    // 有 X-Request-Id 头时返回该值
    expect(
      genReqId({ headers: { 'x-request-id': 'my-trace-id' } } as never),
    ).toBe('my-trace-id');

    // X-Request-Id 为数组时取第一个
    expect(
      genReqId({
        headers: { 'x-request-id': ['trace-a', 'trace-b'] },
      } as never),
    ).toBe('trace-a');

    // 无 X-Request-Id 时生成 UUID 格式
    const generated = genReqId({ headers: {} } as never);
    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('filterSwaggerDocumentForEnvironment 在关闭手动 confirm-paid 时隐藏 club 兜底接口', () => {
    const document = {
      tags: [{ name: 'Club / Orders' }],
      paths: {
        '/club/orders/{id}/confirm-paid': {
          post: { summary: 'service', tags: ['Club / Orders'] },
        },
        '/club/recharge/orders/{id}/confirm-paid': {
          post: { summary: 'recharge', tags: ['Club / Recharge'] },
        },
        '/club/orders/{id}': { get: { summary: 'query' } },
      },
    };

    expect(
      filterSwaggerDocumentForEnvironment(document, {
        manualConfirmPaidEnabled: false,
      }),
    ).toEqual({
      tags: [{ name: 'Club / Orders' }],
      paths: {
        '/club/orders/{id}': { get: { summary: 'query' } },
      },
    });
  });

  it('filterSwaggerDocumentForEnvironment 在开发态保留并高亮 club 兜底接口', () => {
    const document = {
      tags: [{ name: 'Club / Orders' }],
      paths: {
        '/club/orders/{id}/confirm-paid': {
          post: { summary: 'service', tags: ['Club / Orders'] },
        },
        '/club/recharge/orders/{id}/confirm-paid': {
          post: { summary: 'recharge', tags: ['Club / Recharge'] },
        },
      },
    };

    expect(
      filterSwaggerDocumentForEnvironment(document, {
        manualConfirmPaidEnabled: true,
      }),
    ).toEqual({
      tags: [
        { name: 'Club / Orders' },
        {
          name: 'Dev Only / Fallback',
          description:
            '仅开发联调使用的支付兜底接口，生产链路请改用支付回调驱动。',
        },
      ],
      paths: {
        '/club/orders/{id}/confirm-paid': {
          post: {
            summary: 'service',
            tags: ['Club / Orders', 'Dev Only / Fallback'],
          },
        },
        '/club/recharge/orders/{id}/confirm-paid': {
          post: {
            summary: 'recharge',
            tags: ['Club / Recharge', 'Dev Only / Fallback'],
          },
        },
      },
    });
  });

  it('开发环境启动前会清理 3000-3002 残留 node 进程', async () => {
    const bootstrapConfig = {
      get: jest.fn((key: string) => {
        const configMap: Record<string, string | number | boolean> = {
          nodeEnv: 'development',
          'app.logEnabled': true,
          'app.httpBodyLimitBytes': 1024,
          'app.httpKeepAliveTimeoutMs': 70000,
          'app.httpRequestTimeoutMs': 12000,
          'app.corsOrigin': '*',
          'app.portAutoTerminateEnabled': true,
          'app.portAutoShiftEnabled': true,
          'app.portAutoShiftMaxOffset': 2,
          'app.slowRequestLogEnabled': false,
          'app.slowRequestThresholdMs': 800,
          'app.swaggerEnabled': false,
          port: 3000,
        };
        return configMap[key];
      }),
    };
    const runtimeConfig = {
      get: bootstrapConfig.get,
    };

    jest
      .spyOn(ConfigService.prototype, 'get')
      .mockImplementation(bootstrapConfig.get);
    app.get.mockImplementation((token: unknown) => {
      if (token === ConfigService) {
        return runtimeConfig;
      }
      return undefined;
    });
    (childProcess.spawnSync as jest.Mock)
      .mockReturnValueOnce({
        stdout:
          'node 5009 f0rest 18u IPv4 0x1 0t0 TCP *:3000 (LISTEN)\nnode 69928 f0rest 18u IPv4 0x2 0t0 TCP *:3002 (LISTEN)\nredis-ser 3250 f0rest 6u IPv4 0x3 0t0 TCP 127.0.0.1:6379 (LISTEN)\n',
      } as never)
      .mockReturnValueOnce({ stdout: '' } as never)
      .mockReturnValueOnce({ stdout: '' } as never);
    jest.spyOn(process, 'kill').mockImplementation((() => true) as never);

    await bootstrap();

    expect(process.kill).toHaveBeenCalledWith(5009, 'SIGTERM');
    expect(process.kill).toHaveBeenCalledWith(69928, 'SIGTERM');
    expect(app.listen).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith(3000, '0.0.0.0');
    expect(console.warn).toHaveBeenCalledWith(
      '[bootstrap] 启动前清理 3000-3002 端口残留进程: 5009@3000, 69928@3002',
    );
    expect(console.log).toHaveBeenCalledWith(
      'Server running on http://localhost:3000',
    );
  });

  it('开发环境默认端口被占用时会先结束旧进程并复用原端口', async () => {
    const addressInUseError = Object.assign(new Error('EADDRINUSE'), {
      code: 'EADDRINUSE',
    });
    const bootstrapConfig = {
      get: jest.fn((key: string) => {
        const configMap: Record<string, string | number | boolean> = {
          nodeEnv: 'development',
          'app.logEnabled': true,
          'app.httpBodyLimitBytes': 1024,
          'app.httpKeepAliveTimeoutMs': 70000,
          'app.httpRequestTimeoutMs': 12000,
          'app.corsOrigin': '*',
          'app.portAutoTerminateEnabled': true,
          'app.portAutoShiftEnabled': true,
          'app.portAutoShiftMaxOffset': 2,
          'app.slowRequestLogEnabled': false,
          'app.slowRequestThresholdMs': 800,
          'app.swaggerEnabled': false,
          port: 3000,
        };
        return configMap[key];
      }),
    };
    const runtimeConfig = {
      get: bootstrapConfig.get,
    };

    jest
      .spyOn(ConfigService.prototype, 'get')
      .mockImplementation(bootstrapConfig.get);
    app.get.mockImplementation((token: unknown) => {
      if (token === ConfigService) {
        return runtimeConfig;
      }
      return undefined;
    });
    (childProcess.spawnSync as jest.Mock)
      .mockReturnValueOnce({ stdout: '' } as never)
      .mockReturnValueOnce({
        stdout: 'node 4321 f0rest 18u IPv4 0x1 0t0 TCP *:3000 (LISTEN)\n',
      } as never)
      .mockReturnValueOnce({ stdout: '' } as never);
    jest.spyOn(process, 'kill').mockImplementation((() => true) as never);
    app.listen
      .mockRejectedValueOnce(addressInUseError)
      .mockResolvedValueOnce(undefined);

    await bootstrap();

    expect(process.kill).toHaveBeenCalledWith(4321, 'SIGTERM');
    expect(app.listen).toHaveBeenNthCalledWith(1, 3000, '0.0.0.0');
    expect(app.listen).toHaveBeenNthCalledWith(2, 3000, '0.0.0.0');
    expect(console.warn).toHaveBeenCalledWith(
      '[bootstrap] 端口 3000 已被占用，尝试停止旧进程: 4321',
    );
    expect(console.warn).toHaveBeenCalledWith(
      '[bootstrap] 端口 3000 的旧进程已停止，重新尝试监听',
    );
    expect(console.log).toHaveBeenCalledWith(
      'Server running on http://localhost:3000',
    );
  });

  it('开发环境无法结束旧进程时会自动顺延端口', async () => {
    const addressInUseError = Object.assign(new Error('EADDRINUSE'), {
      code: 'EADDRINUSE',
    });
    const bootstrapConfig = {
      get: jest.fn((key: string) => {
        const configMap: Record<string, string | number | boolean> = {
          nodeEnv: 'development',
          'app.logEnabled': true,
          'app.httpBodyLimitBytes': 1024,
          'app.httpKeepAliveTimeoutMs': 70000,
          'app.httpRequestTimeoutMs': 12000,
          'app.corsOrigin': '*',
          'app.portAutoTerminateEnabled': false,
          'app.portAutoShiftEnabled': true,
          'app.portAutoShiftMaxOffset': 2,
          'app.slowRequestLogEnabled': false,
          'app.slowRequestThresholdMs': 800,
          'app.swaggerEnabled': false,
          port: 3000,
        };
        return configMap[key];
      }),
    };
    const runtimeConfig = {
      get: bootstrapConfig.get,
    };

    jest
      .spyOn(ConfigService.prototype, 'get')
      .mockImplementation(bootstrapConfig.get);
    app.get.mockImplementation((token: unknown) => {
      if (token === ConfigService) {
        return runtimeConfig;
      }
      return undefined;
    });
    app.listen
      .mockRejectedValueOnce(addressInUseError)
      .mockResolvedValueOnce(undefined);

    await bootstrap();

    expect(app.listen).toHaveBeenNthCalledWith(1, 3000, '0.0.0.0');
    expect(app.listen).toHaveBeenNthCalledWith(2, 3001, '0.0.0.0');
    expect(console.warn).toHaveBeenCalledWith(
      '[bootstrap] 端口 3000 已被占用，自动尝试 3001',
    );
    expect(console.warn).toHaveBeenCalledWith(
      '[bootstrap] 默认端口 3000 已被占用，服务改为监听 3001',
    );
    expect(console.log).toHaveBeenCalledWith(
      'Server running on http://localhost:3001',
    );
  });
});
