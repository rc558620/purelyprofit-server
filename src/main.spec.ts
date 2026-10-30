import * as childProcess from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import fastify from 'fastify';
import {
  bootstrap,
  filterSwaggerDocumentForEnvironment,
  createRequestIdGenerator,
} from './main';

// 注意：必须保留 @nestjs/core 的其余导出。
// bootstrap 链路里的 new IoAdapter(app) 依赖 @nestjs/core 的 NestApplication 做
// instanceof 判断，若整个模块被替换成只有 NestFactory 的对象，
// 会退化成 `x instanceof undefined` → TypeError。
jest.mock('@nestjs/core', () => ({
  ...jest.requireActual('@nestjs/core'),
  NestFactory: {
    create: jest.fn(),
  },
}));

// 注意：这里的 factory 会替换整个 node:child_process 模块，
// 所有被 import 链触达的导出（如 usb-print.service 的 execFile）都必须补齐，
// 否则下游 promisify(execFile) 会因 execFile 为 undefined 在模块加载期直接抛错。
jest.mock('node:child_process', () => ({
  spawnSync: jest.fn(),
  execFile: jest.fn(
    (
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback?: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback?.(null, '', '');
    },
  ),
}));

// 集群开关单独 mock：它读的是进程环境，而 .env 会在模块求值期被注入，
// 导致端口相关用例随开发者本地配置而红绿不定（详见 beforeEach 注释）
const mockIsClusterMode = jest.fn<boolean, []>(() => false);
jest.mock('./config/cluster.configuration', () => ({
  ...jest.requireActual('./config/cluster.configuration'),
  isClusterMode: () => mockIsClusterMode(),
}));

describe('main bootstrap', () => {
  const createMock = NestFactory.create as jest.MockedFunction<
    typeof NestFactory.create
  >;

  // bootstrap 链路会在 Fastify 实例上注册插件/钩子/原生路由
  // （WebSocket、print-agent 注册等），用真实实例替身可避免逐个补方法的脆弱模拟。
  // 每个用例重建：Fastify 实例不可重复注册同一装饰（@fastify/websocket 的 ws）。
  let fastifyInstance: ReturnType<typeof fastify>;

  const app = {
    useGlobalPipes: jest.fn(),
    useGlobalFilters: jest.fn(),
    setGlobalPrefix: jest.fn(),
    enableCors: jest.fn(),
    register: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    getHttpAdapter: jest.fn(() => ({
      getInstance: () => fastifyInstance,
    })),
    listen: jest.fn().mockResolvedValue(undefined),
    enableShutdownHooks: jest.fn(),
    useWebSocketAdapter: jest.fn(),
  };

  beforeEach(() => {
    // 恢复上一个用例遗留的 spy（如 process.kill），避免实现泄漏到后续用例
    jest.restoreAllMocks();
    jest.clearAllMocks();
    /*
     * 集群模式必须显式声明为 false：
     * app.module.ts 在**求值** ConfigModule.forRoot({ envFilePath: '.env' }) 时就会把
     * .env 注入进程环境（不需要真的实例化模块），本机 .env 里的 CLUSTER_WORKERS
     * 会让 isClusterMode() 变 true；而集群模式按设计跳过端口清理，
     * 端口相关用例就会随「开发者本地 .env 内容」而红绿不定。
     */
    mockIsClusterMode.mockReturnValue(false);
    fastifyInstance = fastify();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    app.useGlobalPipes.mockClear();
    app.useGlobalFilters.mockClear();
    app.setGlobalPrefix.mockClear();
    app.enableCors.mockClear();
    app.get.mockClear();
    // 用 mockReset 而非 mockClear：清掉上一用例未消费的 mockRejectedValueOnce，
    // 否则一次失败会把队列错位带到下一个用例（表现为「端口没被占用」的假通过/假失败）
    app.listen.mockReset();
    app.listen.mockResolvedValue(undefined);
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
          // 平台收款商户号与 APIv3 密钥：商家付费链路的 Native 下单与回调解密依赖，
          // 生产启动校验会强制要求这两项已配置
          'wechat.payMchId': '1900000001',
          'wechat.payApiV3Key': 'prod-demo-api-v3-key',
          // 门店收款配置落库加密主密钥：生产启动校验会强制要求已配置
          WECHAT_PAY_KEY_ENCRYPTION_SECRET: 'prod-demo-encryption-secret',
          'wechat.privateKeyContent':
            '-----BEGIN PRIVATE KEY-----demo-----END PRIVATE KEY-----',
          'wechat.platformPublicKeyContent':
            '-----BEGIN PUBLIC KEY-----demo-----END PUBLIC KEY-----',
          'wechat.payNotifyUrl':
            'https://api.purelyprofit.com/api/club/payments/wechat/callback',
          // 平台收款统一回调：会员真实支付 / 额度充值下单强依赖
          'profit.wechatPayNotifyUrl':
            'https://api.purelyprofit.com/api/profit/payments/wechat/callback',
          // 短信钱包充值专属回调：漏配时商家充值直接 500，启动校验强制要求
          'sms.wechatPayNotifyUrl':
            'https://api.purelyprofit.com/api/marketing/sms/wechat/callback',
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
        clubPaymentModeDebugVisible: false,
        profitPaymentModeDebugVisible: false,
      }),
    ).toEqual({
      tags: [{ name: 'Club / Orders' }],
      paths: {
        '/club/orders/{id}': { get: { summary: 'query' } },
      },
    });
  });

  it('filterSwaggerDocumentForEnvironment 在生产环境隐藏 dev-only 支付模式开关接口', () => {
    const document = {
      tags: [{ name: 'Club / Payments · 调试' }],
      paths: {
        '/club/dev/payment-mode': {
          get: { summary: '查询当前支付模式' },
          post: { summary: '切换支付模式' },
        },
        '/club/orders/{id}': { get: { summary: 'query' } },
      },
    };

    // 生产环境：即便保留了手动确认支付能力，调试开关也必须从文档消失；
    // 路径与 @ApiTags 分组都要消失，否则 tags 列表仍会暴露「调试入口存在」
    const filtered = filterSwaggerDocumentForEnvironment(document, {
      manualConfirmPaidEnabled: true,
      clubPaymentModeDebugVisible: false,
      profitPaymentModeDebugVisible: false,
    });

    expect(filtered.paths).toEqual({
      '/club/orders/{id}': { get: { summary: 'query' } },
    });
    expect(filtered.tags?.map((tag) => tag.name)).not.toContain(
      'Club / Payments · 调试',
    );
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
        clubPaymentModeDebugVisible: true,
        profitPaymentModeDebugVisible: true,
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

  it('filterSwaggerDocumentForEnvironment 剔除带全局前缀的 profit 调试接口', () => {
    const document = {
      tags: [
        { name: 'Club / Payments · 调试' },
        { name: 'Profit / Payments · 调试' },
      ],
      paths: {
        // createDocument 会把 setGlobalPrefix('api') 拼进 key，
        // 清单里的相对路由必须能命中带前缀的真实 key
        '/api/club/dev/payment-mode': {
          get: { summary: '查询当前支付模式' },
          post: { summary: '切换支付模式' },
        },
        '/api/profit/dev/payment-mode': {
          get: { summary: '查询当前支付模式' },
          post: { summary: '切换支付模式' },
        },
        '/api/profit/payments/orders': { get: { summary: '查询平台支付单' } },
      },
    };

    // 只开 club 开关：profit 侧必须被独立剔除，
    // 不能因为 club 可见就把 profit 的入口顺带保留在文档里
    const filtered = filterSwaggerDocumentForEnvironment(document, {
      manualConfirmPaidEnabled: false,
      clubPaymentModeDebugVisible: true,
      profitPaymentModeDebugVisible: false,
    });

    expect(Object.keys(filtered.paths ?? {})).toEqual([
      '/api/club/dev/payment-mode',
      '/api/profit/payments/orders',
    ]);
    expect(filtered.tags?.map((tag) => tag.name)).toEqual([
      'Club / Payments · 调试',
    ]);
  });

  it('filterSwaggerDocumentForEnvironment 对未显式传 true 的调试开关按不可见处理', () => {
    const document = {
      tags: [{ name: 'Profit / Payments · 调试' }],
      paths: {
        '/profit/dev/payment-mode': {
          get: { summary: '查询当前支付模式' },
        },
        '/profit/payments/orders': { get: { summary: '查询平台支付单' } },
      },
    };

    const filtered = filterSwaggerDocumentForEnvironment(document, {
      manualConfirmPaidEnabled: false,
      clubPaymentModeDebugVisible: false,
      profitPaymentModeDebugVisible: false,
    });

    expect(Object.keys(filtered.paths ?? {})).toEqual([
      '/profit/payments/orders',
    ]);
    expect(filtered.tags).toEqual([]);
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

  it('集群模式下不做端口清理：监听句柄由主进程共享，杀进程会打崩其它 worker', async () => {
    mockIsClusterMode.mockReturnValue(true);
    const bootstrapConfig = {
      get: jest.fn((key: string) => {
        const configMap: Record<string, string | number | boolean> = {
          nodeEnv: 'development',
          'app.logEnabled': true,
          'app.httpBodyLimitBytes': 1024,
          'app.httpKeepAliveTimeoutMs': 70000,
          'app.httpRequestTimeoutMs': 12000,
          'app.corsOrigin': '*',
          // 即便显式打开，集群模式下也必须被忽略
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
    jest
      .spyOn(ConfigService.prototype, 'get')
      .mockImplementation(bootstrapConfig.get);
    app.get.mockImplementation((token: unknown) =>
      token === ConfigService ? bootstrapConfig : undefined,
    );
    (childProcess.spawnSync as jest.Mock).mockReturnValue({
      stdout: 'node 5009 f0rest 18u IPv4 0x1 0t0 TCP *:3000 (LISTEN)\n',
    } as never);
    jest.spyOn(process, 'kill').mockImplementation((() => true) as never);

    await bootstrap();

    // 没有扫描端口、没有杀进程，直接监听
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();
    expect(app.listen).toHaveBeenCalledWith(3000, '0.0.0.0');
  });
});
